import { ACTION_ORDER } from '#app/features/auth/auth.constants';
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
import { ROLE_MANAGEMENT } from '#app/features/auth/seeds/permission-dictionary';
import { AuthRole } from '#app/features/auth/entities/auth-role.entity';
import { AuthRolePermission } from '#app/features/auth/entities/auth-role-permission.entity';
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

/** GET /api/roles 的單列。 */
interface RoleRow {
  id: number;
  roleCode: string;
  roleName: string;
  userCount: number;
}

/** 權限矩陣的最小葉節點。 */
interface Perm {
  permissionId: number;
  action: string;
  permissionName: string;
  label: string;
  checked: boolean;
}

interface PermissionMatrix {
  roleId: number;
  groups: Array<{ jobs: Array<{ jobKey: string; permissions: Perm[] }> }>;
}

/** GET /api/roles/:id/users 的單列。 */
interface RoleUserRow {
  id: number;
  empId: string;
  name: string;
  roleName: string;
  departmentName: string | null;
  titleName: string | null;
  lastLoginAt: string | null;
  isActive: boolean;
}

/**
 * 角色與權限層級端點 e2e（Story 1）。
 * 認證一律強制：以 seed 建立的超級管理員 session（session.helper）呼叫，聚焦業務規則與固定格式。
 * 「無權角色 403 FORBIDDEN」由 auth.guard.spec 與 security e2e 覆蓋。
 */
describe('Roles (e2e)', () => {
  let app: NestFastifyApplication;
  let server: E2eServer;
  let api: AuthedRequest;
  let ds: DataSource;
  let viewPermId: number;
  let adminRoleId: number;
  const createdRoleIds: number[] = [];
  const tempUserIds: number[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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
    viewPermId = (
      await ds.query<Array<{ id: number }>>(
        `SELECT id FROM auth_job_permission WHERE permission_key = ? LIMIT 1`,
        [ROLE_MANAGEMENT.VIEW],
      )
    )[0].id;
    adminRoleId = (
      await ds.query<Array<{ id: number }>>(
        `SELECT id FROM auth_roles WHERE role_code = 'ADMIN' LIMIT 1`,
      )
    )[0].id;
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      // 參數化刪除（避免示範字串插值 IN 的反模式）
      if (tempUserIds.length)
        await ds.getRepository(AuthUser).delete({ id: In(tempUserIds) });
      if (createdRoleIds.length) {
        await ds
          .getRepository(AuthRolePermission)
          .delete({ roleId: In(createdRoleIds) });
        await ds.getRepository(AuthRole).delete({ id: In(createdRoleIds) });
      }
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

  it('GET /api/roles → 固定格式正確且含 ADMIN', async () => {
    const res = await api.get('/api/roles').expect(200);
    expectSuccessResponseFormat(res);
    const roles = apiData<RoleRow[]>(res);
    expect(roles.some((r) => r.roleCode === 'ADMIN')).toBe(true);
  });

  it('POST /api/roles → 201，產生 roleCode 並回全列表', async () => {
    const res = await api
      .post('/api/roles')
      .send({ roleName: 'E2E角色', permissionIds: [viewPermId] })
      .expect(201);
    expectSuccessResponseFormat(res);
    const { createdRoleId, roles } = apiData<{
      createdRoleId: number;
      roles: RoleRow[];
    }>(res);
    expect(typeof createdRoleId).toBe('number');
    expect(Array.isArray(roles)).toBe(true);
    createdRoleIds.push(createdRoleId);
  });

  it('GET /api/roles/:id/permissions → 三層層級且指派的權限 checked', async () => {
    const roleId = createdRoleIds[0];
    const res = await api.get(`/api/roles/${roleId}/permissions`).expect(200);
    const matrix = apiData<PermissionMatrix>(res);
    expect(matrix.roleId).toBe(roleId);
    const allPerms = matrix.groups.flatMap((g) =>
      g.jobs.flatMap((j) => j.permissions),
    );
    const viewPerm = allPerms.find((p) => p.permissionId === viewPermId)!;
    expect(viewPerm.checked).toBe(true);
    expect(viewPerm.label).toBe('檢視');
  });

  it('GET /api/roles/:id/permissions → 每個 job 只回它實際擁有的權限', async () => {
    const roleId = createdRoleIds[0];
    const res = await api.get(`/api/roles/${roleId}/permissions`).expect(200);
    const matrix = apiData<PermissionMatrix>(res);

    const jobs = matrix.groups.flatMap((g) => g.jobs);
    expect(jobs.length).toBeGreaterThan(0);

    for (const job of jobs) {
      const actions = job.permissions.map((p) => p.action);
      // ① 回傳的每一筆都是真實存在的權限——不再有 null 佔位可被誤送回 PUT
      for (const p of job.permissions) {
        expect(typeof p.permissionId).toBe('number');
        expect(p.permissionName).not.toBe('');
      }
      // ② 順序仍依 ACTION_ORDER（前端可據此對齊欄位）
      // 直接用正本常數，不在測試裡複製一份欄序（否則兩邊各自漂移）
      const expectedOrder = (ACTION_ORDER as readonly string[]).filter((a) =>
        actions.includes(a),
      );
      expect(actions).toEqual(expectedOrder);
    }

    // job 專屬的 action（如 build）只出現在字典有該權限的 job，MUST NOT 外溢；
    // 目前字典沒有任何 job 擁有 build，故回應中完全不得出現。
    const jobsWithBuild = jobs
      .filter((j) => j.permissions.some((p) => p.action === 'build'))
      .map((j) => j.jobKey);
    expect(jobsWithBuild).toEqual([]);
  });

  it('PUT /api/roles/:id/permissions → 交易覆蓋（清空）', async () => {
    const roleId = createdRoleIds[0];
    const res = await api
      .put(`/api/roles/${roleId}/permissions`)
      .send({ permissionIds: [] })
      .expect(200);
    expect(apiData<unknown>(res)).toEqual({ id: roleId, permissionIds: [] });
  });

  it('PATCH /api/roles/:id → 改名', async () => {
    const roleId = createdRoleIds[0];
    await api
      .patch(`/api/roles/${roleId}`)
      .send({ roleName: 'E2E改名' })
      .expect(200);
    const list = apiData<RoleRow[]>(await api.get('/api/roles'));
    expect(list.find((r) => r.id === roleId)?.roleName).toBe('E2E改名');
  });

  it('PUT /api/roles/reorder → 整批排序並改名（ADMIN 帶原名）', async () => {
    const before = apiData<RoleRow[]>(await api.get('/api/roles'));
    const targetId = createdRoleIds[0];
    const roles = before
      .map((r) => ({
        roleId: r.id,
        roleName: r.id === targetId ? 'E2E排序改名' : r.roleName,
      }))
      .reverse();
    await api.put('/api/roles/reorder').send({ roles }).expect(200);

    const after = apiData<RoleRow[]>(await api.get('/api/roles'));
    expect(after.find((r) => r.id === targetId)?.roleName).toBe('E2E排序改名');
  });

  it('reorder 改 ADMIN 名稱 → 403 ADMIN_ROLE_LOCKED', async () => {
    const list = apiData<RoleRow[]>(await api.get('/api/roles'));
    const roles = list.map((r) => ({
      roleId: r.id,
      roleName: r.roleCode === 'ADMIN' ? `${r.roleName}_改` : r.roleName,
    }));
    const res = await api.put('/api/roles/reorder').send({ roles }).expect(403);
    expectErrorResponseFormat(res, 'ADMIN_ROLE_LOCKED');
  });

  it('GET /api/roles/:id/users → 空清單', async () => {
    const res = await api
      .get(`/api/roles/${createdRoleIds[0]}/users`)
      .expect(200);
    expect(apiData<unknown>(res)).toEqual([]);
  });

  it('DELETE /api/roles/:id → 軟刪一個臨時角色', async () => {
    const { createdRoleId: created } = apiData<{ createdRoleId: number }>(
      await api.post('/api/roles').send({ roleName: 'E2E待刪' }),
    );
    const res = await api.delete(`/api/roles/${created}`).expect(200);
    expect(apiData<unknown>(res)).toEqual({ success: true });
  });

  // ── RESTful 動詞遷移：舊 POST 別名應失效（不得保留）──

  it('舊動詞下架：POST /api/roles/:id/delete、/reorder、/:id → 404', async () => {
    await api.post(`/api/roles/${adminRoleId}/delete`).expect(404);
    await api.post('/api/roles/reorder').send({ roles: [] }).expect(404);
    await api
      .post(`/api/roles/${adminRoleId}`)
      .send({ roleName: 'x' })
      .expect(404);
  });

  // ── 錯誤路徑（固定格式 + error.code）──

  it('改名 ADMIN → 403 ADMIN_ROLE_LOCKED', async () => {
    const res = await api
      .patch(`/api/roles/${adminRoleId}`)
      .send({ roleName: '改不得' })
      .expect(403);
    expectErrorResponseFormat(res, 'ADMIN_ROLE_LOCKED');
  });

  it('指派無效權限 → 400 INVALID_PERMISSION_IDS', async () => {
    const res = await api
      .post('/api/roles')
      .send({ roleName: 'E2E無效權限', permissionIds: [999999] })
      .expect(400);
    expectErrorResponseFormat(res, 'INVALID_PERMISSION_IDS');
  });

  it('操作不存在角色 → 404 ROLE_NOT_FOUND', async () => {
    const res = await api
      .patch('/api/roles/999999')
      .send({ roleName: 'x' })
      .expect(404);
    expectErrorResponseFormat(res, 'ROLE_NOT_FOUND');
  });

  it('空 roleName → 400 INVALID_REQUEST', async () => {
    const res = await api.post('/api/roles').send({ roleName: '' }).expect(400);
    expectErrorResponseFormat(res, 'INVALID_REQUEST');
  });

  it('刪除仍有使用者綁定的角色 → 409 ROLE_HAS_USERS', async () => {
    const { createdRoleId: roleId } = apiData<{ createdRoleId: number }>(
      await api.post('/api/roles').send({ roleName: 'E2E綁定' }),
    );
    createdRoleIds.push(roleId);

    const inserted = await ds.query<InsertResult>(
      `INSERT INTO auth_users (person_empid, person_name, role_id, is_active)
       VALUES (?, ?, ?, 1)`,
      [`E2E_${Date.now()}`, 'E2E使用者', roleId],
    );
    tempUserIds.push(Number(inserted.insertId));

    const res = await api.delete(`/api/roles/${roleId}`).expect(409);
    expectErrorResponseFormat(res, 'ROLE_HAS_USERS');
  });

  // ── US3：角色使用者清單新增 lastLoginAt / isActive（含已停用帳號）──

  it('GET /api/roles/:id/users → 每筆含 lastLoginAt/isActive，已停用者也在清單', async () => {
    const { createdRoleId: roleId } = apiData<{ createdRoleId: number }>(
      await api.post('/api/roles').send({ roleName: 'E2E角色US3' }),
    );
    createdRoleIds.push(roleId);

    // 啟用 + 有登入時間
    const active = await ds.query<InsertResult>(
      `INSERT INTO auth_users (person_empid, person_name, role_id, department_name, title_name, last_login_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [
        `E2E_US3A_${Date.now()}`,
        'US3啟用',
        roleId,
        'IT部',
        '工程師',
        '2026-07-06 14:43:13',
      ],
    );
    tempUserIds.push(Number(active.insertId));
    // 停用 + 從未登入
    const disabled = await ds.query<InsertResult>(
      `INSERT INTO auth_users (person_empid, person_name, role_id, is_active)
       VALUES (?, ?, ?, 0)`,
      [`E2E_US3D_${Date.now()}`, 'US3停用', roleId],
    );
    tempUserIds.push(Number(disabled.insertId));

    const res = await api.get(`/api/roles/${roleId}/users`).expect(200);
    const users = apiData<RoleUserRow[]>(res);

    expect(users).toHaveLength(2);
    const activeRow = users.find((u) => u.id === Number(active.insertId))!;
    expect(activeRow).toMatchObject({ isActive: true });
    expect(activeRow.lastLoginAt).not.toBeNull();
    // 既有欄位不變
    expect(activeRow).toMatchObject({
      empId: expect.any(String) as string,
      name: 'US3啟用',
      roleName: 'E2E角色US3',
      departmentName: 'IT部',
      titleName: '工程師',
    });

    const disabledRow = users.find((u) => u.id === Number(disabled.insertId))!;
    expect(disabledRow).toMatchObject({
      roleName: 'E2E角色US3',
      isActive: false,
      lastLoginAt: null,
    });
  });
});
