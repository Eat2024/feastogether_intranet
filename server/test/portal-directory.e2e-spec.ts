import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '#app/app.module';
import {
  configureApp,
  createFastifyAdapter,
  registerFastifyPlugins,
} from '#app/bootstrap/app.bootstrap';
import { PortalConfig } from '#app/infrastructure/portal/portal.config';
import { PortalDirectoryService } from '#app/infrastructure/portal/portal-directory.service';
import { PortalModule } from '#app/infrastructure/portal/portal.module';
import {
  PORTAL_SENTINEL,
  createSyntheticPortal,
  portalConfigFrom,
  startUnresponsivePortal,
  type SyntheticPortal,
  type UnresponsivePortal,
} from './synthetic-portal.helper';

const byEmpid = (a: { person_empid: string }, b: { person_empid: string }) =>
  a.person_empid.localeCompare(b.person_empid);

describe('Portal 唯讀連線（合成 Portal）', () => {
  let portal: SyntheticPortal;
  let unresponsive: UnresponsivePortal | undefined;
  const apps: NestFastifyApplication[] = [];

  async function startApp(
    override: (builder: TestingModuleBuilder) => TestingModuleBuilder = (
      builder,
    ) => builder,
  ): Promise<NestFastifyApplication> {
    const moduleRef = await override(
      Test.createTestingModule({ imports: [AppModule, PortalModule] }),
    ).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(
      createFastifyAdapter(),
      { bodyParser: false },
    );
    apps.push(app);
    configureApp(app);
    await registerFastifyPlugins(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  }

  beforeAll(async () => {
    portal = await createSyntheticPortal();
    await portal.insertDepartments([
      { department_ch_id: '0100', department_name: '總管理處' },
      {
        department_ch_id: '0120',
        department_name: 'a 小寫部',
        department_parent_guid: '0100',
      },
      {
        department_ch_id: '0112',
        department_name: 'B 大寫部',
        department_parent_guid: '0100',
      },
      {
        department_ch_id: '0111',
        department_name: 'B 大寫部',
        department_parent_guid: '0100',
        startdate: '2020-01-01',
      },
      {
        department_ch_id: '0130',
        department_name: '已裁撤部',
        department_parent_guid: '0100',
        stopdate: '2025-12-31',
      },
    ]);
    await portal.insertPeople([
      {
        person_empid: '000123',
        person_name: '𠮷野堃喆',
        person_status: 1,
        department_id: '0111',
        department_name: '堃喆資訊部',
        title: '工程師',
        email: 'synthetic.000123@example.test',
      },
      {
        person_empid: 'A001',
        person_name: '王正式',
        person_status: 1,
        department_id: '0100',
      },
      {
        person_empid: '000045',
        person_name: '林試用',
        person_status: 0,
        department_id: '0120',
      },
      { person_empid: '000999', person_name: '陳離職', person_status: 2 },
    ]);
  });

  afterAll(async () => {
    // 先關不回應的 server：逾時後 pool 仍在替排隊的呼叫建立連線，pool.end() 會等它們連線逾時
    await unresponsive?.close();
    await Promise.all(apps.map((app) => app.close()));
    await portal?.drop();
  });

  it('四個查詢讀回合成資料：4-byte 中文、罕用字與前導零員編完整，哨兵值不出現在結果中', async () => {
    const service = (await startApp()).get(PortalDirectoryService);

    const orgChart = await service.listOrgChartSource();
    expect(orgChart.departments).toEqual([
      {
        department_ch_id: '0111',
        department_name: 'B 大寫部',
        department_parent_guid: '0100',
        startdate: '2020-01-01',
        stopdate: null,
      },
      {
        department_ch_id: '0112',
        department_name: 'B 大寫部',
        department_parent_guid: '0100',
        startdate: '',
        stopdate: null,
      },
      {
        department_ch_id: '0120',
        department_name: 'a 小寫部',
        department_parent_guid: '0100',
        startdate: '',
        stopdate: null,
      },
      {
        department_ch_id: '0100',
        department_name: '總管理處',
        department_parent_guid: '',
        startdate: '',
        stopdate: null,
      },
    ]);
    expect(orgChart.employees).toEqual([
      {
        person_empid: '000123',
        person_name: '𠮷野堃喆',
        title: '工程師',
        department_id: '0111',
      },
      {
        person_empid: 'A001',
        person_name: '王正式',
        title: '',
        department_id: '0100',
      },
    ]);

    const staff = await service.findEmployeesByEmpid('000123');
    expect(staff).toEqual([
      {
        person_empid: '000123',
        person_name: '𠮷野堃喆',
        department_id: '0111',
        department_name: '堃喆資訊部',
        title: '工程師',
        person_status: 1,
      },
    ]);
    // Portal collation 不分大小寫：呼叫端必須自行以 === 精確比對員編
    const caseInsensitive = await service.findEmployeesByEmpid('a001');
    expect(caseInsensitive.map((row) => row.person_empid)).toEqual(['A001']);

    const active = await service.listActiveEmployees();
    expect([...active].sort(byEmpid)).toEqual([
      {
        person_empid: '000045',
        person_name: '林試用',
        department_id: '0120',
        department_name: '',
        title: '',
        email: '',
        person_status: 0,
      },
      {
        person_empid: '000123',
        person_name: '𠮷野堃喆',
        department_id: '0111',
        department_name: '堃喆資訊部',
        title: '工程師',
        email: 'synthetic.000123@example.test',
        person_status: 1,
      },
      {
        person_empid: 'A001',
        person_name: '王正式',
        department_id: '0100',
        department_name: '',
        title: '',
        email: '',
        person_status: 1,
      },
    ]);

    const statuses = await service.findStatusesByEmpids([
      '000999',
      '000123',
      'NOT-IN-PORTAL',
    ]);
    expect([...statuses].sort(byEmpid)).toEqual([
      { person_empid: '000123', person_status: 1 },
      { person_empid: '000999', person_status: 2 },
    ]);

    const sentinelRows = await portal.query<{ person_pass: string }>(
      'SELECT person_pass FROM sys_person',
    );
    expect(sentinelRows.map((row) => row.person_pass)).toContain(
      PORTAL_SENTINEL,
    );
    expect(
      JSON.stringify([orgChart, staff, caseInsensitive, active, statuses]),
    ).not.toContain(PORTAL_SENTINEL);
  });

  it('PORTAL_MYSQL_* 缺漏時 HTTP app 照常啟動，查詢時才拒絕且訊息不含設定值', async () => {
    const app = await startApp((builder) =>
      builder
        .overrideProvider(PortalConfig)
        .useValue(
          portalConfigFrom({ PORTAL_MYSQL_HOST: 'portal.synthetic.invalid' }),
        ),
    );

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);

    const rejection = app.get(PortalDirectoryService).listActiveEmployees();
    await expect(rejection).rejects.toThrow('PORTAL_MYSQL_');
    await expect(rejection).rejects.not.toThrow('portal.synthetic.invalid');
  });

  it('Portal 不回應時 HTTP app 照常啟動，超過連線上限的 7 個並發查詢都在 15 秒內拒絕', async () => {
    unresponsive = await startUnresponsivePortal();
    const { config } = unresponsive;
    const app = await startApp((builder) =>
      builder.overrideProvider(PortalConfig).useValue(config),
    );

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);

    const service = app.get(PortalDirectoryService);
    const startedAt = Date.now();
    const results = await Promise.allSettled(
      Array.from({ length: 7 }, () => service.findEmployeesByEmpid('000123')),
    );

    expect(Date.now() - startedAt).toBeLessThan(15_000);
    expect(results.map((result) => result.status)).toEqual(
      Array(7).fill('rejected'),
    );
  }, 20_000);
});
