import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { REDIS_MAIN } from '#app/infrastructure/database/redis/redis.provider';
import { RedisService } from '#app/infrastructure/database/redis/redis.service';
import { EsignSignerCandidateService } from '#app/features/esign/services/esign-signer-candidate.service';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { FeastogetherClient } from '#app/infrastructure/http-client/feastogether/feastogether.client';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { assertTestRedisDb } from '#app/infrastructure/database/test/ensure-test-redis';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { PortalConfig } from '#app/infrastructure/portal/portal.config';
import { PortalDirectoryService } from '#app/infrastructure/portal/portal-directory.service';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  SecurityE2eContext,
} from './security-e2e.helper';
import {
  PORTAL_SENTINEL,
  createSyntheticPortal,
  portalConfigFrom,
  startUnresponsivePortal,
  type SyntheticDepartment,
  type SyntheticPortal,
  type UnresponsivePortal,
} from './synthetic-portal.helper';

const route = '/api/esign/signer-candidates/org-chart';
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const headers = { cookie: `${AUTH_COOKIE_NAME}=synthetic-session` };
const sha256 = (value: unknown[]) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const environment = () => process.env.NODE_ENV ?? 'development';
/** 快取 key 照 tasks T010：esign:org-chart:v2: + sha256([NODE_ENV, 'portal', host, port, db])。 */
const orgChartKey = (config: PortalConfig) =>
  `esign:org-chart:v2:${sha256([environment(), 'portal', config.host, config.port, config.database])}`;

const employee = (person_empid: string, person_name: string, title = '') => ({
  person_empid,
  person_name,
  title,
});
const node = (
  department_ch_id: string,
  department_name: string,
  department_parent_guid: string | null,
  employees: ReturnType<typeof employee>[],
  children: unknown[] = [],
  startdate = '',
) => ({
  department_ch_id,
  department_name,
  department_parent_guid,
  startdate,
  stopdate: null,
  children,
  employees,
});

/**
 * 依饗賓人 hr/org_chart（fgapi OrgChartBuilder）規則手算的預期樹：
 * 部門依名稱 UTF-8 位元組排序（孤兒部 e5ada4 < 營運本部 e7879f < 空部門課 e7a9ba < 總管理處 e7b8bd < 資訊部 < 開發課），
 * 上層已停用的孤兒部成為根節點；試用與離職員工不列入；子部門員工不出現在上層。
 */
const expectedTree = [
  node('0300', '孤兒部', '0900', [employee('000800', '吳孤兒')]),
  node('0200', '營運本部', null, [employee('000700', '周營運')]),
  node(
    '0100',
    '總管理處',
    null,
    [employee('A001', '王正式', '處長')],
    [
      node(
        '0110',
        '資訊部',
        '0100',
        [],
        [
          node('0112', '空部門課', '0110', []),
          node('0111', '開發課', '0110', [
            employee('000123', '𠮷野堃喆', '工程師'),
            employee('000124', '劉工程'),
          ]),
        ],
      ),
    ],
    '2020-01-01',
  ),
];

describe('組織樹 API（合成 Portal）', () => {
  let portal: SyntheticPortal;
  let unresponsive: UnresponsivePortal | undefined;
  let ctx: SecurityE2eContext;
  let slow: SecurityE2eContext;
  let misconfigured: SecurityE2eContext;
  const contexts: SecurityE2eContext[] = [];
  let client: Redis;
  let key: string;
  let legacyKeys: string[];
  let sources: jest.SpyInstance[];
  const sourceCalls = () =>
    sources.reduce((total, spy) => total + spy.mock.calls.length, 0);
  // 饗賓人 client 一被呼叫就失敗；afterEach 另外確認呼叫數為 0（app 內的錯誤可能被轉成 502）。
  const feastogether = {
    get: jest.fn((path: string) => {
      throw new Error(`測試不得呼叫饗賓人 ${path}`);
    }),
    post: jest.fn((path: string) => {
      throw new Error(`測試不得呼叫饗賓人 ${path}`);
    }),
  };
  const createApp = (config?: PortalConfig) =>
    createSecurityE2eApp((builder) => {
      builder
        .overrideProvider(FeastogetherClient)
        .useValue(feastogether)
        .overrideProvider(AuthService)
        .useValue({
          verifySessionToken: (token: string) =>
            Promise.resolve(
              token === 'synthetic-session' ? { userId: 1 } : null,
            ),
        });
      return config
        ? builder.overrideProvider(PortalConfig).useValue(config)
        : builder;
    });

  beforeAll(async () => {
    assertTestRedisDb();
    portal = await createSyntheticPortal();
    await portal.insertDepartments([
      {
        department_ch_id: '0100',
        department_name: '總管理處',
        startdate: '2020-01-01',
      },
      {
        department_ch_id: '0110',
        department_name: '資訊部',
        department_parent_guid: '0100',
      },
      {
        department_ch_id: '0111',
        department_name: '開發課',
        department_parent_guid: '0110',
      },
      {
        department_ch_id: '0112',
        department_name: '空部門課',
        department_parent_guid: '0110',
      },
      { department_ch_id: '0200', department_name: '營運本部' },
      {
        department_ch_id: '0300',
        department_name: '孤兒部',
        department_parent_guid: '0900',
      },
      {
        department_ch_id: '0900',
        department_name: '已裁撤部',
        stopdate: '2025-12-31',
      },
    ]);
    await portal.insertPeople([
      {
        person_empid: '000124',
        person_name: '劉工程',
        person_status: 1,
        department_id: '0111',
      },
      {
        person_empid: '000123',
        person_name: '𠮷野堃喆',
        person_status: 1,
        department_id: '0111',
        title: '工程師',
      },
      {
        person_empid: 'A001',
        person_name: '王正式',
        person_status: 1,
        department_id: '0100',
        title: '處長',
      },
      {
        person_empid: '000045',
        person_name: '林試用',
        person_status: 0,
        department_id: '0110',
      },
      {
        person_empid: '000999',
        person_name: '陳離職',
        person_status: 2,
        department_id: '0110',
      },
      {
        person_empid: '000500',
        person_name: '張停用部',
        person_status: 1,
        department_id: '0900',
      },
      { person_empid: '000600', person_name: '李無部門', person_status: 1 },
      {
        person_empid: '000700',
        person_name: '周營運',
        person_status: 1,
        department_id: '0200',
      },
      {
        person_empid: '000800',
        person_name: '吳孤兒',
        person_status: 1,
        department_id: '0300',
      },
    ]);

    for (let i = 0; i < 2; i++) contexts.push(await createApp());
    ctx = contexts[0];
    unresponsive = await startUnresponsivePortal();
    slow = await createApp(unresponsive.config);
    misconfigured = await createApp(
      portalConfigFrom({
        PORTAL_MYSQL_HOST: 'portal.synthetic.invalid',
        PORTAL_MYSQL_USER: 'synthetic_reader',
        PORTAL_MYSQL_PASS: 'synthetic-pass',
      }),
    );
    client = ctx.app.get<Redis>(REDIS_MAIN);
    key = orgChartKey(ctx.app.get(PortalConfig));
    const feastogetherNamespace = sha256([
      environment(),
      ctx.app.get(ConfigService).get<string>('FEASTOGETHER_BASE_URL'),
    ]);
    legacyKeys = [
      `esign:org-chart:v2:${feastogetherNamespace}`,
      `esign:org-chart:v1:${feastogetherNamespace}`,
    ];
    sources = contexts.map((context) =>
      jest.spyOn(context.app.get(PortalDirectoryService), 'listOrgChartSource'),
    );
  }, 60_000);

  beforeEach(async () => {
    await client.del(key, ...legacyKeys);
    for (const spy of sources) spy.mockClear();
  });

  afterEach(() => {
    expect(feastogether.get).not.toHaveBeenCalled();
    expect(feastogether.post).not.toHaveBeenCalled();
  });

  afterAll(async () => {
    if (client?.status === 'ready') await client.del(key, ...legacyKeys);
    // 先關不回應的 server：逾時後 pool 仍在替排隊的呼叫建立連線，pool.end() 會等它們連線逾時
    await unresponsive?.close();
    await Promise.all(
      [...contexts, slow, misconfigured]
        .filter(Boolean)
        .map((context) => closeSecurityE2eApp(context)),
    );
    await portal?.drop();
  });

  it('有效員工 session 由 Portal 組樹：envelope／no-store、結構與排序同饗賓人規則、寫入 1,800 秒快取，無業務資料異動', async () => {
    const manager = ctx.app.get(MysqlService).getManager();
    const tables = [
      'users',
      'esign_documents',
      'esign_signers',
      'esign_signature_records',
    ];
    const counts = () =>
      Promise.all(
        tables.map((table) =>
          manager.query(`SELECT COUNT(*) AS count FROM ${table}`),
        ),
      );
    const warn = jest.spyOn(ctx.app.get(AppLoggerService), 'warn');
    try {
      const before = await counts();
      const response = await ctx.app.inject({
        method: 'GET',
        url: route,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<unknown>()).toEqual({
        success: true,
        data: expectedTree,
        timestamp: expect.any(String) as unknown,
      });
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.body).not.toContain(PORTAL_SENTINEL);
      expect(await counts()).toEqual(before);
      expect(JSON.parse((await client.get(key)) ?? 'null')).toEqual({
        version: 1,
        data: expectedTree,
      });
      expect(await client.ttl(key)).toBeGreaterThan(1790);
      expect(await client.ttl(key)).toBeLessThanOrEqual(1800);
      // 停用部門與空部門代碼的 2 位正式員工對不到部門：log 只記人數
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'esign.org_chart_unmapped_employees',
          metadata: { unmappedEmployees: 2 },
        }),
      );
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(
        /000500|000600|張停用部|李無部門/,
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('Portal 合法空資料回傳空陣列並快取', async () => {
    // 暫時換成同結構的空表，測完換回
    await portal.query(
      'RENAME TABLE chi_department TO chi_department_full, sys_person TO sys_person_full',
    );
    try {
      await portal.query(
        'CREATE TABLE chi_department LIKE chi_department_full',
      );
      await portal.query('CREATE TABLE sys_person LIKE sys_person_full');
      const response = await ctx.app.inject({
        method: 'GET',
        url: route,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: unknown }>().data).toEqual([]);
      expect(await client.get(key)).toBe(
        JSON.stringify({ version: 1, data: [] }),
      );
      expect(await client.ttl(key)).toBeGreaterThan(1790);
    } finally {
      await portal.query('DROP TABLE IF EXISTS chi_department, sys_person');
      await portal.query(
        'RENAME TABLE chi_department_full TO chi_department, sys_person_full TO sys_person',
      );
    }
  });

  it('缺少或失效 session 回 401，不查 Portal', async () => {
    for (const value of ['', `${AUTH_COOKIE_NAME}=invalid`]) {
      const response = await ctx.app.inject({
        method: 'GET',
        url: route,
        headers: { cookie: value },
      });
      expect(response.statusCode).toBe(401);
    }
    expect(sourceCalls()).toBe(0);
  });

  it('兩個 HTTP 實例共用快取，1,000 次讀取不查 Portal 也不續期', async () => {
    for (const context of contexts) {
      const response = await context.app.inject({
        method: 'GET',
        url: route,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: unknown }>().data).toEqual(expectedTree);
    }
    expect(sourceCalls()).toBe(1);
    const before = await client.pttl(key);
    expect(before).toBeGreaterThan(1_790_000);
    expect(before).toBeLessThanOrEqual(1_800_000);
    for (let i = 0; i < 1_000; i++)
      await contexts[i % 2].app.get(EsignSignerCandidateService).getOrgChart();
    expect(await client.pttl(key)).toBeLessThan(before);
    expect(sourceCalls()).toBe(1);
  });

  it('饗賓人來源的舊快取（v1、v2）不會延用，也不刪除', async () => {
    for (const legacy of legacyKeys)
      await client.set(
        legacy,
        JSON.stringify({ version: 1, data: [] }),
        'EX',
        1800,
      );
    const response = await ctx.app.inject({
        method: 'GET',
        url: route,
        headers,
      });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: unknown }>().data).toEqual(expectedTree);
    expect(sourceCalls()).toBe(1);
    for (const legacy of legacyKeys)
      expect(await client.ttl(legacy)).toBeGreaterThan(1790);
  });

  it('有效／無快取時，無效 session 均不讀組織快取', async () => {
    const read = jest.spyOn(ctx.app.get(RedisService), 'get');
    try {
      for (const cached of [false, true]) {
        if (cached)
          await client.set(
            key,
            JSON.stringify({ version: 1, data: [] }),
            'EX',
            1800,
          );
        for (const cookie of ['', `${AUTH_COOKIE_NAME}=invalid`]) {
          expect(
            (
              await ctx.app.inject({
                method: 'GET',
                url: route,
                headers: { cookie },
              })
            ).statusCode,
          ).toBe(401);
        }
      }
      expect(read).not.toHaveBeenCalled();
      expect(sourceCalls()).toBe(0);
    } finally {
      read.mockRestore();
    }
  });

  it('快取到期不自動更新，只由下一次請求更新', async () => {
    const service = ctx.app.get(EsignSignerCandidateService);
    await service.getOrgChart();
    await client.pexpire(key, 30);
    await pause(60);
    expect(await client.get(key)).toBeNull();
    expect(sourceCalls()).toBe(1);
    await service.getOrgChart();
    expect(sourceCalls()).toBe(2);
  });

  it('Swagger 描述完整 envelope 與遞迴部門 DTO', () => {
    const document = SwaggerModule.createDocument(
      ctx.app,
      new DocumentBuilder().build(),
    );
    const responses = document.paths[route].get?.responses;
    expect(responses?.['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/SignerCandidateOrgChartResponseDto',
          },
        },
      },
    });
    expect(
      document.components?.schemas?.SignerCandidateOrgChartResponseDto,
    ).toMatchObject({
      required: ['success', 'timestamp', 'data'],
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/OrgDepartmentDto' },
        },
      },
    });
    expect(
      document.components?.schemas?.EmployeeDirectoryErrorResponseDto,
    ).toMatchObject({
      required: ['success', 'error', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [false] },
        error: { $ref: '#/components/schemas/EmployeeDirectoryErrorDto' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    });
    expect(
      document.components?.schemas?.EmployeeDirectoryErrorDto,
    ).toMatchObject({ required: ['code', 'message'] });
    for (const status of ['401', '502', '503'])
      expect(responses?.[status]).toMatchObject({
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/EmployeeDirectoryErrorResponseDto',
            },
          },
        },
      });
  });

  it.each<[string, SyntheticDepartment[]]>([
    ['部門代碼為空', [{ department_ch_id: '', department_name: '無代碼部' }]],
    [
      '部門名稱無法解碼（U+FFFD）',
      [{ department_ch_id: '0830', department_name: '無法�解碼部' }],
    ],
    [
      '部門代碼重複',
      [{ department_ch_id: '0200', department_name: '重複營運部' }],
    ],
    [
      '上下層形成循環',
      [
        {
          department_ch_id: '0810',
          department_name: '循環甲',
          department_parent_guid: '0820',
        },
        {
          department_ch_id: '0820',
          department_name: '循環乙',
          department_parent_guid: '0810',
        },
      ],
    ],
  ])('%s時整批回 502，不寫快取', async (_case, departments) => {
    await portal.insertDepartments(departments);
    try {
      const response = await ctx.app.inject({
        method: 'GET',
        url: route,
        headers,
      });
      expect(response.statusCode).toBe(502);
      expect(response.json<unknown>()).toMatchObject({
      success: false,
      error: { code: 'ORG_CHART_UPSTREAM_UNAVAILABLE' },
    });
      expect(await client.get(key)).toBeNull();
    } finally {
      await portal.query(
        'DELETE FROM chi_department WHERE department_name IN (?)',
        [departments.map((department) => department.department_name)],
      );
    }
  });

  it('部門表無法讀取時，同時未命中的請求各自查 Portal、都回 502 不快取，也不帶出連線設定；人員表照常可讀，恢復後新請求可成功', async () => {
    const config = ctx.app.get(PortalConfig);
    // 以改名模擬部門表權限被收回（查詢回 table doesn't exist），測完改回
    await portal.query('RENAME TABLE chi_department TO chi_department_revoked');
    try {
      const responses = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          contexts[i % 2].app.inject({ method: 'GET', url: route, headers }),
        ),
      );
      for (const response of responses) {
        expect(response.statusCode).toBe(502);
        expect(response.json<unknown>()).toMatchObject({
      success: false,
      error: { code: 'ORG_CHART_UPSTREAM_UNAVAILABLE' },
    });
        for (const value of [config.host, config.user, config.database])
      expect(response.body).not.toContain(value);
        expect(response.body).not.toContain('chi_department');
      }
      expect(sourceCalls()).toBe(50);
      expect(await client.get(key)).toBeNull();
      // 只需要人員表的登入查詢不受影響
      await expect(
        ctx.app.get(PortalDirectoryService).findEmployeesByEmpid('000123'),
      ).resolves.toEqual([
        expect.objectContaining({ person_empid: '000123', person_status: 1 }),
      ]);
    } finally {
      await portal.query(
        'RENAME TABLE chi_department_revoked TO chi_department',
      );
    }
    const recovered = await ctx.app.inject({
      method: 'GET',
      url: route,
      headers,
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json<{ data: unknown }>().data).toEqual(expectedTree);
  }, 30_000);

  it('Portal 不回應時 15 秒內回 502，不寫快取，也不帶出連線設定', async () => {
    const config = slow.app.get(PortalConfig);
    const started = Date.now();
    const response = await slow.app.inject({
      method: 'GET',
      url: route,
      headers,
    });
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(response.statusCode).toBe(502);
    expect(response.json<unknown>()).toMatchObject({
      success: false,
      error: { code: 'ORG_CHART_UPSTREAM_UNAVAILABLE' },
    });
    for (const value of [config.host, config.user, config.database])
      expect(response.body).not.toContain(value);
    expect(await client.get(orgChartKey(config))).toBeNull();
  }, 20_000);

  it('Portal 設定缺漏時 app 照常啟動，查詢回 502，不帶出設定值或變數名稱', async () => {
    const response = await misconfigured.app.inject({
      method: 'GET',
      url: route,
      headers,
    });
    expect(response.statusCode).toBe(502);
    expect(response.json<unknown>()).toMatchObject({
      success: false,
      error: { code: 'ORG_CHART_UPSTREAM_UNAVAILABLE' },
    });
    for (const value of [
      'portal.synthetic.invalid',
      'synthetic_reader',
      'synthetic-pass',
      'PORTAL_MYSQL',
    ])
      expect(response.body).not.toContain(value);
  });

  it('Redis 錯誤回 503，不回傳原始錯誤或直連 Portal', async () => {
    const read = jest
      .spyOn(ctx.app.get(RedisService), 'get')
      .mockRejectedValueOnce(new Error('synthetic-private-data'));
    try {
      const response = await ctx.app.inject({
        method: 'GET',
        url: route,
        headers,
      });
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain('synthetic-private-data');
      expect(sourceCalls()).toBe(0);
    } finally {
      read.mockRestore();
    }
  });
});
