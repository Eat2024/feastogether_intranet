import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPool } from 'mysql2/promise';
import { PortalConfig } from './portal.config';
import { PortalDirectoryService } from './portal-directory.service';

jest.mock('mysql2/promise', () => ({ createPool: jest.fn() }));

const portalEnv = {
  PORTAL_MYSQL_HOST: 'portal.synthetic.invalid',
  PORTAL_MYSQL_PORT: '3307',
  PORTAL_MYSQL_USER: 'synthetic_reader',
  PORTAL_MYSQL_PASS: 'synthetic-pass',
  PORTAL_MYSQL_DB: 'synthetic_portal',
};

function createService(env: Record<string, string> = portalEnv) {
  return new PortalDirectoryService(
    new PortalConfig(new ConfigService(env)),
  );
}

describe('PortalDirectoryService', () => {
  const query = jest.fn();
  const end = jest.fn();

  beforeEach(() => {
    query.mockReset().mockResolvedValue([[], []]);
    end.mockReset().mockResolvedValue(undefined);
    jest.mocked(createPool).mockReset().mockReturnValue({ query, end } as never);
  });

  it('組織樹查詢送出合約的部門與正式員工 SQL，連線池使用合約參數', async () => {
    query
      .mockResolvedValueOnce([[{ department_ch_id: 'D1' }], []])
      .mockResolvedValueOnce([[{ person_empid: '000123' }], []]);

    const result = await createService().listOrgChartSource();

    expect(result).toEqual({
      departments: [{ department_ch_id: 'D1' }],
      employees: [{ person_empid: '000123' }],
    });
    expect(createPool).toHaveBeenCalledTimes(1);
    expect(createPool).toHaveBeenCalledWith({
      host: 'portal.synthetic.invalid',
      port: 3307,
      user: 'synthetic_reader',
      password: 'synthetic-pass',
      database: 'synthetic_portal',
      charset: 'utf8mb4',
      connectionLimit: 3,
      connectTimeout: 10_000,
    });
    expect(query.mock.calls).toEqual([
      [
        {
          sql: 'SELECT department_ch_id, department_name, department_parent_guid, startdate, stopdate\nFROM chi_department WHERE stopdate IS NULL\nORDER BY CAST(department_name AS BINARY), department_ch_id',
          values: undefined,
          timeout: 10_000,
        },
      ],
      [
        {
          sql: 'SELECT person_empid, person_name, title, department_id\nFROM sys_person WHERE person_status = 1 ORDER BY person_empid',
          values: undefined,
          timeout: 10_000,
        },
      ],
    ]);
  });

  it('登入查詢以員編為參數，原樣回傳所有資料列', async () => {
    const rows = [
      { person_empid: 'A001', person_status: 1 },
      { person_empid: 'a001 ', person_status: 2 },
    ];
    query.mockResolvedValueOnce([rows, []]);

    await expect(createService().findEmployeesByEmpid('A001')).resolves.toEqual(
      rows,
    );

    expect(query).toHaveBeenCalledWith({
      sql: 'SELECT person_empid, person_name, department_id, department_name, title, person_status\nFROM sys_person WHERE person_empid = ?',
      values: ['A001'],
      timeout: 10_000,
    });
  });

  it('匯入查詢在職名單（試用與正式）', async () => {
    const rows = [{ person_empid: 'A001', email: '' }];
    query.mockResolvedValueOnce([rows, []]);

    await expect(createService().listActiveEmployees()).resolves.toEqual(rows);

    expect(query).toHaveBeenCalledWith({
      sql: 'SELECT person_empid, person_name, department_id, department_name, title, email, person_status\nFROM sys_person WHERE person_status IN (0, 1)',
      values: undefined,
      timeout: 10_000,
    });
  });

  it('狀態查詢每批最多 500 個員編，合併各批結果', async () => {
    const empids = Array.from({ length: 1001 }, (_, i) => `E${i}`);
    query
      .mockResolvedValueOnce([[{ person_empid: 'E0', person_status: 2 }], []])
      .mockResolvedValueOnce([[{ person_empid: 'E500', person_status: 4 }], []])
      .mockResolvedValueOnce([[], []]);

    await expect(createService().findStatusesByEmpids(empids)).resolves.toEqual(
      [
        { person_empid: 'E0', person_status: 2 },
        { person_empid: 'E500', person_status: 4 },
      ],
    );

    const calls = query.mock.calls as [{ sql: string; values: string[] }][];
    expect(calls.map(([options]) => options.values)).toEqual([
      empids.slice(0, 500),
      empids.slice(500, 1000),
      ['E1000'],
    ]);
    expect(calls[2]?.[0]).toEqual({
      sql: 'SELECT person_empid, person_status FROM sys_person WHERE person_empid IN (?)',
      values: ['E1000'],
      timeout: 10_000,
    });
    expect(calls[0]?.[0].sql).toBe(
      `SELECT person_empid, person_status FROM sys_person WHERE person_empid IN (${Array(500).fill('?').join(', ')})`,
    );
  });

  it('狀態查詢傳入空陣列時不送出查詢、不建立連線池', async () => {
    await expect(createService().findStatusesByEmpids([])).resolves.toEqual(
      [],
    );

    expect(createPool).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('所有查詢都是 SELECT，不寫入也不讀密碼、身分證字號、生日欄位', async () => {
    const service = createService();
    await service.listOrgChartSource();
    await service.findEmployeesByEmpid('A001');
    await service.listActiveEmployees();
    await service.findStatusesByEmpids(['A001']);

    const sqls = (query.mock.calls as [{ sql: string }][]).map(
      ([options]) => options.sql,
    );
    expect(sqls).toHaveLength(5);
    for (const sql of sqls) {
      expect(sql).toMatch(/^SELECT /);
      expect(sql).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|REPLACE|person_pass|person_id_no|birthdate)\b/i,
      );
    }
  });

  // mysql2 把無法解碼的位元組換成 U+FFFD，不會報錯；讀到時整次查詢視為來源錯誤（spec Edge Cases）。
  it.each<[string, (service: PortalDirectoryService) => Promise<unknown>]>([
    ['組織樹', (service) => service.listOrgChartSource()],
    ['登入', (service) => service.findEmployeesByEmpid('A001')],
    ['在職名單', (service) => service.listActiveEmployees()],
    ['狀態', (service) => service.findStatusesByEmpids(['A001'])],
  ])(
    '%s查詢讀到無法解碼的文字（U+FFFD）時拒絕，訊息不含資料內容',
    async (_name, call) => {
      const row = {
        person_empid: 'A001',
        person_name: '王�明',
        person_status: 1,
        stopdate: null,
      };
      query.mockResolvedValue([[row], []]);

      const rejection = call(createService());

      await expect(rejection).rejects.toThrow('無法解碼');
      await expect(rejection).rejects.not.toThrow('A001');
      await expect(rejection).rejects.not.toThrow('王');
    },
  );

  it('設定缺漏時建構不拋錯也不連線，第一次查詢才拒絕且訊息不含設定值', async () => {
    const partialEnv = {
      PORTAL_MYSQL_HOST: 'portal.synthetic.invalid',
      PORTAL_MYSQL_USER: 'synthetic_reader',
    };
    const service = createService(partialEnv);
    expect(createPool).not.toHaveBeenCalled();

    const rejection = service.listActiveEmployees();

    await expect(rejection).rejects.toThrow('PORTAL_MYSQL_');
    for (const value of Object.values(partialEnv)) {
      await expect(rejection).rejects.not.toThrow(value);
    }
    expect(createPool).not.toHaveBeenCalled();
  });

  it('多次查詢共用同一個連線池；未設定埠與密碼時使用 3306 與空密碼', async () => {
    const {
      PORTAL_MYSQL_PORT: _port,
      PORTAL_MYSQL_PASS: _pass,
      ...envWithoutPortAndPass
    } = portalEnv;
    const service = createService(envWithoutPortAndPass);

    await service.listActiveEmployees();
    await service.findEmployeesByEmpid('A001');

    expect(createPool).toHaveBeenCalledTimes(1);
    expect(createPool).toHaveBeenCalledWith(
      expect.objectContaining({ port: 3306, password: '' }),
    );
  });

  describe('整體期限', () => {
    afterEach(() => jest.useRealTimers());

    it('含排隊等連線在內，查詢 10 秒未完成即拒絕', async () => {
      jest.useFakeTimers();
      query.mockReturnValue(new Promise(() => {}));

      const rejection = createService().listActiveEmployees();
      const assertion = expect(rejection).rejects.toThrow('10 秒');
      await jest.advanceTimersByTimeAsync(10_000);

      await assertion;
    });

    it('查詢完成後不留下計時器', async () => {
      jest.useFakeTimers();

      await createService().listActiveEmployees();

      expect(jest.getTimerCount()).toBe(0);
    });
  });

  it('模組銷毀時關閉連線池；從未查詢時不建立連線池', async () => {
    const used = createService();
    await used.listActiveEmployees();
    await used.onModuleDestroy();
    expect(end).toHaveBeenCalledTimes(1);

    jest.mocked(createPool).mockClear();
    await createService().onModuleDestroy();
    expect(createPool).not.toHaveBeenCalled();
  });

  it('Portal 不可用時關閉連線池失敗不阻擋應用結束，log 只記錯誤代碼', async () => {
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    end.mockRejectedValue(
      Object.assign(new Error('connect ECONNRESET portal.synthetic.invalid'), {
        code: 'ECONNRESET',
      }),
    );
    const service = createService();
    await service.listActiveEmployees();

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();

    const logged = JSON.stringify(logError.mock.calls);
    expect(logged).toContain('ECONNRESET');
    expect(logged).not.toContain('portal.synthetic.invalid');
    logError.mockRestore();
  });
});
