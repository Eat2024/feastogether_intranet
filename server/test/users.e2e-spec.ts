import {
  FeastogetherHrService,
  staffLookupError,
} from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type { Response } from 'supertest';
import { DataSource, In } from 'typeorm';
import { AppModule } from '#app/app.module';
import {
  configureApp,
  registerFastifyPlugins,
} from '#app/bootstrap/app.bootstrap';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { AuthRole } from '#app/features/auth/entities/auth-role.entity';
import { AuthUser } from '#app/features/auth/entities/auth-user.entity';
import {
  apiData,
  apiEnvelope,
  apiError,
  apiSuccess,
  type E2eServer,
  type InsertResult,
} from './api-response.helper';
import {
  authedRequest,
  issueSuperAdminCookie,
  type AuthedRequest,
} from './session.helper';

/** GET /api/users 列表／詳情的單列。 */
interface UserRow {
  empId: string;
  name: string;
  isActive: boolean;
  isSystemAdmin: boolean;
  personStatus: string | null;
  role: { id: number } | null;
}

/** GET /api/users 的 data（分頁欄位與 users 同層，不包 meta）。 */
interface UserListData {
  users: UserRow[];
  page: number;
  pageSize: number;
  total: number;
}

/** GET /api/users/employees 的單筆 option。 */
interface EmployeeOption {
  empId: string;
  name: string;
  departmentName: string | null;
  isActive: boolean;
}

/**
 * 使用者帳號與角色指派端點 e2e（Story 2）。
 * 認證一律強制：以 seed 建立的超級管理員 session（session.helper）呼叫，聚焦業務規則與固定格式。
 * 「停用後該 user 呼叫受保護端點 403」屬 AuthGuard 授權行為，
 * 由 auth.guard.spec 與 security e2e 覆蓋（授權失敗 → FORBIDDEN）；
 * 此處驗證停用已落庫（detail.isActive=false）。
 */
describe('Users (e2e)', () => {
  const hr = { lookupStaff: jest.fn() };
  let app: NestFastifyApplication;
  let server: E2eServer;
  let api: AuthedRequest;
  let ds: DataSource;
  let roleId: number;
  let secondRoleId: number;
  const tempUserIds: number[] = [];
  const createdRoleIds: number[] = [];

  const seedUser = async (empid: string, rid: number | null) => {
    const inserted = await ds.query<InsertResult>(
      `INSERT INTO auth_users (person_empid, person_name, role_id, department_name, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [empid, 'E2E帳號', rid, '門市測試'],
    );
    const id = Number(inserted.insertId);
    tempUserIds.push(id);
    return id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FeastogetherHrService)
      .useValue(hr)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    configureApp(app);
    await registerFastifyPlugins(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpAdapter().getInstance().server;
    api = authedRequest(server, await issueSuperAdminCookie(app));
    ds = app.get<DataSource>(MYSQL_MAIN);
    roleId = (
      await ds.query<Array<{ id: number }>>(
        `SELECT id FROM auth_roles WHERE role_code = 'ADMIN' LIMIT 1`,
      )
    )[0].id;

    // 一個臨時啟用角色，供「指派覆蓋」用
    const r = await ds.query<InsertResult>(
      `INSERT INTO auth_roles (role_code, role_name, is_admin, is_active, sort_order)
       VALUES (?, 'E2E可指派', 0, 1, 999)`,
      [`ROLE_E2E_${Date.now()}`],
    );
    secondRoleId = Number(r.insertId);
    createdRoleIds.push(secondRoleId);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      if (tempUserIds.length)
        await ds.getRepository(AuthUser).delete({ id: In(tempUserIds) });
      if (createdRoleIds.length)
        await ds.getRepository(AuthRole).delete({ id: In(createdRoleIds) });
    }
    await app?.close();
  });

  const expectSuccessResponseFormat = (res: Response) => {
    const body = apiEnvelope<unknown>(res);
    expect(body.success).toBe(true);
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('timestamp');
    expect(body).not.toHaveProperty('path');
  };

  const expectErrorResponseFormat = (res: Response, code: string) => {
    expect(apiSuccess(res)).toBe(false);
    expect(apiError(res).code).toBe(code);
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).not.toHaveProperty('path');
  };

  it('GET /api/users → 固定格式正確、users 與分頁欄位同層（不包 meta）', async () => {
    await seedUser(`E2E_LIST_${Date.now()}`, roleId);
    const res = await api.get('/api/users?page=1&pageSize=5').expect(200);
    expectSuccessResponseFormat(res);
    const data = apiData<UserListData>(res);
    expect(Array.isArray(data.users)).toBe(true);
    expect(data).toMatchObject({ page: 1, pageSize: 5 });
    expect(typeof data.total).toBe('number');
    // 分頁欄位一律第一層（2026-07-29 全站統一）
    expect(data).not.toHaveProperty('meta');
  });

  it('GET /api/users?keyword= → 關鍵字命中工號', async () => {
    const empid = `E2E_KW_${Date.now()}`;
    await seedUser(empid, roleId);
    const res = await api.get(`/api/users?keyword=${empid}`).expect(200);
    const { users } = apiData<UserListData>(res);
    expect(users.some((u) => u.empId === empid)).toBe(true);
  });

  it('GET /api/users → 列表項含 isActive / personStatus / isSystemAdmin', async () => {
    const empid = `E2E_FIELDS_${Date.now()}`;
    await seedUser(empid, roleId); // ADMIN 角色
    const res = await api.get(`/api/users?keyword=${empid}`).expect(200);
    const hit = apiData<UserListData>(res).users.find((u) => u.empId === empid);
    expect(hit).toBeDefined();
    expect(hit).toHaveProperty('personStatus'); // 保留（饗賓人在職狀態）
    expect(hit!.isActive).toBe(true); // 本地帳號啟用
    expect(hit!.isSystemAdmin).toBe(true); // ADMIN 角色
  });

  it('GET /api/users?roleId= → 依角色 id 精準篩選', async () => {
    const empid = `E2E_ROLEID_${Date.now()}`;
    await seedUser(empid, secondRoleId);
    const res = await api.get(`/api/users?roleId=${secondRoleId}`).expect(200);
    const { users } = apiData<UserListData>(res);
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((u) => u.role?.id === secondRoleId)).toBe(true);
  });

  it('GET /api/users/:id → 詳情含 isSystemAdmin', async () => {
    const empid = `E2E_DETAIL_${Date.now()}`;
    const uid = await seedUser(empid, roleId); // ADMIN
    const res = await api.get(`/api/users/${uid}`).expect(200);
    expect(apiData<UserRow>(res).isSystemAdmin).toBe(true);
  });

  it('PATCH /api/users/:empId → 指派覆蓋角色', async () => {
    const empid = `E2E_ASSIGN_${Date.now()}`;
    await seedUser(empid, roleId);
    const res = await api
      .patch(`/api/users/${empid}`)
      .send({ roleId: secondRoleId })
      .expect(200);
    expectSuccessResponseFormat(res);
    expect(apiData<UserRow>(res).role).toMatchObject({ id: secondRoleId });
  });

  it('PATCH /api/users/:empId → 停用落庫（detail.isActive=false）', async () => {
    const empid = `E2E_DISABLE_${Date.now()}`;
    const uid = await seedUser(empid, secondRoleId); // 非 admin 角色，可停用
    await api
      .patch(`/api/users/${empid}`)
      .send({ isActive: false })
      .expect(200);
    const res = await api.get(`/api/users/${uid}`).expect(200);
    expect(apiData<UserRow>(res).isActive).toBe(false);
  });

  it('PATCH /api/users/:empId → 停用系統管理員被擋 → 403 ADMIN_ROLE_LOCKED', async () => {
    const empid = `E2E_DISADMIN_${Date.now()}`;
    const uid = await seedUser(empid, roleId); // ADMIN 角色
    const res = await api
      .patch(`/api/users/${empid}`)
      .send({ isActive: false })
      .expect(403);
    expectErrorResponseFormat(res, 'ADMIN_ROLE_LOCKED');
    const detail = await api.get(`/api/users/${uid}`).expect(200);
    expect(apiData<UserRow>(detail).isActive).toBe(true); // 未落庫
  });

  it('指派不存在 / 停用角色 → 400 INVALID_ROLE_ID', async () => {
    const empid = `E2E_BADROLE_${Date.now()}`;
    await seedUser(empid, roleId);
    const res = await api
      .patch(`/api/users/${empid}`)
      .send({ roleId: 999999 })
      .expect(400);
    expectErrorResponseFormat(res, 'INVALID_ROLE_ID');
  });

  // roleId 為 ADMIN 角色（beforeAll 取自 role_code='ADMIN'，is_admin=1）
  it('指派系統管理員角色被擋 → 403 ADMIN_ROLE_LOCKED（防提權）', async () => {
    const empid = `E2E_ESCALATE_${Date.now()}`;
    const uid = await seedUser(empid, secondRoleId); // 起始為一般角色
    const res = await api
      .patch(`/api/users/${empid}`)
      .send({ roleId })
      .expect(403);
    expectErrorResponseFormat(res, 'ADMIN_ROLE_LOCKED');
    // 確認未落庫：詳情角色仍為原一般角色
    const detail = await api.get(`/api/users/${uid}`).expect(200);
    expect(apiData<UserRow>(detail).role).toMatchObject({ id: secondRoleId });
  });

  it('操作不存在員編 → 404 USER_NOT_FOUND', async () => {
    const res = await api
      .patch('/api/users/NOSUCH_EMP_999')
      .send({ isActive: false })
      .expect(404);
    expectErrorResponseFormat(res, 'USER_NOT_FOUND');
  });

  it('舊動詞下架：POST /api/users/:empId → 404', async () => {
    const empid = `E2E_OLDVERB_${Date.now()}`;
    await seedUser(empid, roleId);
    await api.post(`/api/users/${empid}`).send({ isActive: false }).expect(404);
  });

  it('無新增使用者端點：POST /api/users → 404（僅 /:empId 存在）', async () => {
    await api.post('/api/users').send({ name: 'x' }).expect(404);
  });

  // ── US4：批次啟用/停用（atomic；停用擋超管） ──

  it('PATCH /api/users/status → 一般帳號批次停用成功', async () => {
    const a = `E2E_BATCH_A_${Date.now()}`;
    const b = `E2E_BATCH_B_${Date.now()}`;
    const uidA = await seedUser(a, secondRoleId);
    const uidB = await seedUser(b, secondRoleId);
    const res = await api
      .patch('/api/users/status')
      .send({ empIds: [a, b], isActive: false })
      .expect(200);
    expectSuccessResponseFormat(res); // success 由 envelope 表達
    // 一次帶回這批 empId 的最新列資料（形狀同列表），前端免再打 GET
    const { users: returned } = apiData<UserListData>(res);
    expect(returned.map((u) => u.empId).sort()).toEqual([a, b].sort());
    expect(returned.every((u) => u.isActive === false)).toBe(true);
    expect(returned.every((u) => u.isSystemAdmin === false)).toBe(true);
    for (const uid of [uidA, uidB]) {
      const d = await api.get(`/api/users/${uid}`).expect(200);
      expect(apiData<UserRow>(d).isActive).toBe(false);
    }
  });

  it('PATCH /api/users/status → 帶 roleId 回傳該角色全部使用者最新狀態', async () => {
    const a = `E2E_BR_A_${Date.now()}`;
    const b = `E2E_BR_B_${Date.now()}`;
    await seedUser(a, secondRoleId);
    await seedUser(b, secondRoleId);
    const res = await api
      .patch('/api/users/status')
      .send({ empIds: [a], isActive: false, roleId: secondRoleId })
      .expect(200);
    const { users: returned } = apiData<UserListData>(res);
    // 只更新 a，但回傳整個角色（含未被操作的 b）
    expect(returned.map((u) => u.empId)).toEqual(
      expect.arrayContaining([a, b]),
    );
    expect(returned.every((u) => u.role?.id === secondRoleId)).toBe(true);
    expect(returned.find((u) => u.empId === a)!.isActive).toBe(false);
    expect(returned.find((u) => u.empId === b)!.isActive).toBe(true); // 未動
  });

  it('PATCH /api/users/status → 含超管的停用整批擋下 403，無一被改', async () => {
    const normal = `E2E_BATCH_N_${Date.now()}`;
    const admin = `E2E_BATCH_ADM_${Date.now()}`;
    const uidN = await seedUser(normal, secondRoleId);
    await seedUser(admin, roleId); // ADMIN
    const res = await api
      .patch('/api/users/status')
      .send({ empIds: [normal, admin], isActive: false })
      .expect(403);
    expectErrorResponseFormat(res, 'ADMIN_ROLE_LOCKED');
    const d = await api.get(`/api/users/${uidN}`).expect(200);
    expect(apiData<UserRow>(d).isActive).toBe(true); // rollback：一般帳號未被停用
  });

  it('PATCH /api/users/status → 含超管的「啟用」不擋，全部啟用', async () => {
    const admin = `E2E_BATCH_ENA_${Date.now()}`;
    const uid = await seedUser(admin, roleId);
    await ds.query(`UPDATE auth_users SET is_active=0 WHERE id=?`, [uid]);
    const res = await api
      .patch('/api/users/status')
      .send({ empIds: [admin], isActive: true })
      .expect(200);
    expect(apiSuccess(res)).toBe(true);
    const d = await api.get(`/api/users/${uid}`).expect(200);
    expect(apiData<UserRow>(d).isActive).toBe(true);
  });

  it('PATCH /api/users/status → 含查無 empId 整批 404', async () => {
    const a = `E2E_BATCH_MISS_${Date.now()}`;
    const uid = await seedUser(a, secondRoleId);
    const res = await api
      .patch('/api/users/status')
      .send({ empIds: [a, 'NOSUCH_EMP_X'], isActive: false })
      .expect(404);
    expectErrorResponseFormat(res, 'USER_NOT_FOUND');
    const d = await api.get(`/api/users/${uid}`).expect(200);
    expect(apiData<UserRow>(d).isActive).toBe(true); // rollback
  });

  it('PATCH /api/users/status → 空 empIds → 400', async () => {
    await api
      .patch('/api/users/status')
      .send({ empIds: [], isActive: false })
      .expect(400);
  });

  it('5～8 碼模糊搜尋不建檔，選定第二位員工後儲存角色才匯入', async () => {
    const keyword = String(Date.now()).slice(-5);
    const empId = `991${keyword}`;
    const profiles = [`001${keyword}`, empId].map((id, index) => ({
      person_empid: id,
      person_name: `測試員${index + 1}號`,
      person_status: 1,
      person_status_name: '正式',
      department_id: 'TEST01',
      department_name: null,
      title: '測試職稱',
    }));
    hr.lookupStaff.mockImplementation((query: string) =>
      Promise.resolve(profiles.filter((p) => p.person_empid.includes(query))),
    );
    const lookup = await api
      .get(`/api/users/employees?empId=${keyword}`)
      .expect(200);
    expect(apiData<EmployeeOption[]>(lookup)).toEqual(
      profiles.map((profile) => ({
        empId: profile.person_empid,
        name: profile.person_name,
        departmentName: null,
        isActive: true,
      })),
    );
    expect(
      await ds
        .getRepository(AuthUser)
        .countBy({ personEmpid: In(profiles.map((p) => p.person_empid)) }),
    ).toBe(0);
    // 不合法角色造成整筆交易回滾，不能留下半套帳號。
    await api
      .patch(`/api/users/${empId}`)
      .send({ roleId: 999999999 })
      .expect(400);
    expect(
      await ds.getRepository(AuthUser).countBy({ personEmpid: empId }),
    ).toBe(0);
    // 兩位主管同時加入同一員工，也只能建立一筆帳號。
    const [saved, concurrent] = await Promise.all(
      [0, 1].map(() =>
        api
          .patch(`/api/users/${empId}`)
          .send({ roleId: secondRoleId })
          .expect(200),
      ),
    );
    const id = apiData<{ id: number }>(saved).id;
    expect(apiData<{ id: number }>(concurrent).id).toBe(id);
    tempUserIds.push(id);
    const user = await ds.getRepository(AuthUser).findOneByOrFail({ id });
    expect(user).toMatchObject({
      personEmpid: empId,
      personName: '測試員2號',
      personStatus: '正式',
      lastLoginAt: null,
    });
    expect(Number(user.roleId)).toBe(Number(secondRoleId));
    await api
      .patch(`/api/users/${empId}`)
      .send({ isActive: false })
      .expect(200);
    const again = await api
      .get(`/api/users/employees?empId=${empId}`)
      .expect(200);
    expect(
      apiData<EmployeeOption[]>(again).find((p) => p.empId === empId)?.isActive,
    ).toBe(false);
    expect(hr.lookupStaff).toHaveBeenCalledWith(empId);
    expect(
      await ds
        .getRepository(AuthUser)
        .countBy({ personEmpid: profiles[0].person_empid }),
    ).toBe(0);
    expect(
      await ds.getRepository(AuthUser).countBy({ personEmpid: empId }),
    ).toBe(1);
  });

  it('查詢失敗使用統一訊息；模糊搜尋拒絕長度錯誤與萬用字元', async () => {
    hr.lookupStaff.mockRejectedValue(staffLookupError());
    const res = await api.get('/api/users/employees?empId=99999').expect(502);
    expect(apiError(res)).toMatchObject({
      code: 'STAFF_LOOKUP_FAILED',
      message: '系統有錯，請詢問IT部門',
    });
    await api.get('/api/users/employees?empId=').expect(400);
    await api.get('/api/users/employees?empId=1234').expect(400);
    await api.get('/api/users/employees?empId=123456789').expect(400);
    await api.get('/api/users/employees?empId=TEST%25').expect(400);
  });
});
