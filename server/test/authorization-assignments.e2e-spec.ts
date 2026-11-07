import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
} from './security-e2e.helper';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { ConsoleModule } from '#app/console/console.module';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { createAuthorizationConsole } from '#app/console/helpers/authorization.helpers';
import { createSyntheticPortal } from './synthetic-portal.helper';
import {
  withAuthorizationDatabase,
  initializeAuthorizationOperator,
} from './helpers/authorization-fixtures';
import {
  createAuthorizationHttpApp,
  createAuthorizationSession,
} from './helpers/authorization-http-fixtures';

jest.setTimeout(120_000);
const base = '/api/authorization/modules/esign';
interface AssignmentView {
  userId: string;
  moduleKey: string;
  roleIds: string[];
  implicitRoles: Array<{ roleCode: string; source: string }>;
  changed: boolean;
}

it('Super 可預先指派尚未登入員工，讀回角色與稽核；相同目標重送不重複記錄', async () => {
  const portal = await createSyntheticPortal();
  try {
    await portal.insertPeople([
      {
        person_empid: 'AZPRE01',
        person_name: '合成預指派員工',
        person_status: 1,
        department_id: 'AZDEP',
        department_name: '合成部門',
      },
    ]);
    await withAuthorizationDatabase(async (db) => {
      const { catalog } = await initializeAuthorizationOperator(db);
      await catalog.syncCatalog();
      const app = await createAuthorizationHttpApp(db);
      try {
        const cookie = await createAuthorizationSession(app, {
          kind: 'super_user',
        });
        const headers = { cookie, origin: 'http://localhost:3000' };
        const roles = (
          await app.inject({ method: 'GET', url: `${base}/roles`, headers })
        ).json<{ data: { items: Array<{ id: string; roleCode: string }> } }>()
          .data.items;
        const roleId = roles.find((r) => r.roleCode === 'document_creator')!.id;
        const payload = {
          empId: 'AZPRE01',
          roleIds: [roleId],
          expectedRoleIds: [],
        };
        const result = await app.inject({
          method: 'POST',
          url: `${base}/employee-role-assignments`,
          headers,
          payload,
        });
        expect(result.statusCode).toBe(200);
        expect(result.headers['cache-control']).toBe('no-store');
        const assigned = result.json<{ data: AssignmentView }>().data;
        expect(assigned.userId).toMatch(/^[1-9][0-9]*$/);
        expect(assigned).toEqual({
          userId: assigned.userId,
          moduleKey: 'esign',
          roleIds: [roleId],
          implicitRoles: [{ roleCode: 'colleague', source: 'baseline' }],
          changed: true,
        });
        expect(
          (
            await app.inject({
              method: 'GET',
              url: `${base}/employees/${assigned.userId}/roles`,
              headers,
            })
          ).json<{ data: unknown }>().data,
        ).toEqual({
          userId: assigned.userId,
          moduleKey: 'esign',
          roleIds: [roleId],
          implicitRoles: assigned.implicitRoles,
        });
        const members = await app.inject({
          method: 'GET',
          url: `${base}/roles/${roleId}/employees`,
          headers,
        });
        expect(members.json<{ data: unknown }>().data).toEqual({
          items: [{ userId: assigned.userId, name: '合成預指派員工' }],
          nextCursor: null,
        });
        expect(
          (
            await app.inject({
              method: 'POST',
              url: `${base}/employee-role-assignments`,
              headers,
              payload,
            })
          ).json<{ data: AssignmentView }>().data.changed,
        ).toBe(false);
        const events = (
          await app.inject({
            method: 'GET',
            url: '/api/authorization/events?limit=100',
            headers,
          })
        )
          .json<{
            data: {
              items: Array<{
                eventType: string;
                before: unknown;
                after: unknown;
                actorKind: string;
                source: string;
              }>;
            };
          }>()
          .data.items.filter((e) => e.eventType === 'user.roles_updated');
        expect(events).toEqual([
          expect.objectContaining({
            actorKind: 'super_user',
            source: 'http',
            before: null,
            after: { userId: assigned.userId, roleIds: [roleId] },
          }),
        ]);
        expect(JSON.stringify(events)).not.toContain('AZPRE01');
        const employee = await createAuthorizationSession(app, {
          kind: 'employee',
          userId: Number(assigned.userId),
        });
        const view = await app.inject({
          method: 'GET',
          url: '/api/me/authorization',
          headers: { cookie: employee },
        });
        expect(
          view.json<{ data: { modules: Array<{ permissions: string[] }> } }>()
            .data.modules[0].permissions,
        ).toContain('esign.document.create');
      } finally {
        await app.close();
      }
    });
  } finally {
    await portal.drop();
  }
});

it('目標資格精確查核且不登出管理者；本地停用、刪除與員編大小寫碰撞拒絕', async () => {
  const portal = await createSyntheticPortal();
  try {
    await portal.insertPeople([
      { person_empid: 'AZINVALID', person_name: '合成離職', person_status: 2 },
      { person_empid: 'AZDUP', person_name: '合成重複甲', person_status: 1 },
      { person_empid: 'AZDUP', person_name: '合成重複乙', person_status: 1 },
      { person_empid: 'AZCASE', person_name: '合成大寫', person_status: 1 },
      { person_empid: 'AZSPACE', person_name: '合成原碼', person_status: 1 },
      { person_empid: 'AZDISABLE', person_name: '合成停用', person_status: 1 },
      { person_empid: 'AZDELETE', person_name: '合成刪除', person_status: 1 },
      { person_empid: 'AZCOLLIDE', person_name: '合成碰撞', person_status: 1 },
    ]);
    await withAuthorizationDatabase(async (db) => {
      const { catalog } = await initializeAuthorizationOperator(db);
      await catalog.syncCatalog();
      await db.query(
        "INSERT INTO users(empid,name,is_active,deleted_at) VALUES('AZDISABLE','合成停用',0,NULL),('AZDELETE','合成刪除',1,NOW(6)),('azcollide','合成既有小寫',1,NULL)",
      );
      const app = await createAuthorizationHttpApp(db);
      try {
        const cookie = await createAuthorizationSession(app, {
          kind: 'super_user',
        });
        const headers = { cookie, origin: 'http://localhost:3000' };
        for (const empId of [
          'AZMISSING',
          'AZINVALID',
          'AZDUP',
          'azcase',
          'AZSPACE ',
          ' AZSPACE',
          'AZCOLLIDE',
        ]) {
          const response = await app.inject({
            method: 'POST',
            url: `${base}/employee-role-assignments`,
            headers,
            payload: { empId, roleIds: ['2'], expectedRoleIds: [] },
          });
          expect(response.statusCode).toBe(422);
          expect(response.json<{ error: { code: string } }>().error.code).toBe(
            'AUTHORIZATION_EMPLOYEE_INELIGIBLE',
          );
          expect(response.headers['set-cookie']).toBeUndefined();
          expect(response.body).not.toContain(empId);
          expect(
            (
              await app.inject({
                method: 'GET',
                url: '/api/me/authorization',
                headers,
              })
            ).statusCode,
          ).toBe(200);
        }
        for (const empId of ['AZDISABLE', 'AZDELETE']) {
          const response = await app.inject({
            method: 'POST',
            url: `${base}/employee-role-assignments`,
            headers,
            payload: { empId, roleIds: ['2'], expectedRoleIds: [] },
          });
          expect(response.statusCode).toBe(403);
          expect(response.json<{ error: { code: string } }>().error.code).toBe(
            'ACCOUNT_DISABLED',
          );
        }
        await portal.query('RENAME TABLE sys_person TO unavailable_people');
        const failed = await app.inject({
          method: 'POST',
          url: `${base}/employee-role-assignments`,
          headers,
          payload: { empId: 'AZCASE', roleIds: ['2'], expectedRoleIds: [] },
        });
        expect(failed.statusCode).toBe(502);
        expect(failed.json<{ error: { code: string } }>().error.code).toBe(
          'STAFF_LOOKUP_FAILED',
        );
        expect(failed.body).not.toContain('sys_person');
        expect(failed.body).not.toContain('AZCASE');
      } finally {
        await app.close();
      }
    });
  } finally {
    await portal.drop();
  }
});

it('僅Super可指派，嚴格拒絕未知欄位、重複／過量／跨範圍與同仁角色', async () => {
  const portal = await createSyntheticPortal();
  try {
    await portal.insertPeople([
      {
        person_empid: 'AZSTRICT',
        person_name: '合成輸入員工',
        person_status: 1,
      },
    ]);
    await withAuthorizationDatabase(async (db) => {
      const { catalog } = await initializeAuthorizationOperator(db);
      await catalog.syncCatalog();
      await db.query(
        "INSERT INTO users(empid,name) VALUES('AZVIEW','合成檢視員工')",
      );
      await db.query(
        "INSERT INTO authorization_roles(module_key,role_code,role_name) VALUES('platform','test-only','合成跨範圍')",
      );
      const app = await createAuthorizationHttpApp(db);
      try {
        const cookie = await createAuthorizationSession(app, {
            kind: 'super_user',
          }),
          employee = await createAuthorizationSession(app, {
            kind: 'employee',
            userId: 1,
          });
        const headers = { cookie, origin: 'http://localhost:3000' },
          url = `${base}/employee-role-assignments`,
          valid = { empId: 'AZSTRICT', roleIds: ['2'], expectedRoleIds: [] };
        for (const auth of [{}, { cookie: employee }])
          for (const [method, path] of [
            ['POST', url],
            ['GET', `${base}/employees/1/roles`],
            ['GET', `${base}/roles/2/employees`],
          ] as const) {
            expect(
              (
                await app.inject({
                  method,
                  url: path,
                  headers: { ...auth, origin: headers.origin },
                  ...(method === 'POST' ? { payload: valid } : {}),
                })
              ).statusCode,
            ).toBe('cookie' in auth ? 403 : 401);
          }
        expect(
          (
            await app.inject({
              method: 'POST',
              url,
              headers: { cookie },
              payload: valid,
            })
          ).statusCode,
        ).toBe(403);
        for (const payload of [
          { ...valid, empId: '' },
          { ...valid, empId: 'x'.repeat(33) },
          { ...valid, empId: 123 },
          { ...valid, roleIds: ['2', '2'] },
          { ...valid, roleIds: Array(51).fill('2') },
          { ...valid, roleIds: [2] },
          { ...valid, roleIds: ['9007199254740992'] },
          { ...valid, roleIds: ['02'] },
          { ...valid, roleIds: null },
          { ...valid, expectedRoleIds: ['2', '2'] },
          { ...valid, expectedRoleIds: Array(51).fill('2') },
          { ...valid, actor: { kind: 'super_user' } },
          { ...valid, userId: '1' },
        ]) {
          const r = await app.inject({ method: 'POST', url, headers, payload });
          expect(r.statusCode).toBe(400);
          expect(r.json<{ error: { code: string } }>().error.code).toBe(
            'REQUEST_FORMAT_INVALID',
          );
        }
        for (const roles of [
          { roleIds: ['1'], expectedRoleIds: [] },
          { roleIds: ['2'], expectedRoleIds: ['1'] },
        ]) {
          const r = await app.inject({
            method: 'POST',
            url,
            headers,
            payload: { empId: 'AZSTRICT', ...roles },
          });
          expect(r.statusCode).toBe(403);
          expect(r.json<{ error: { code: string } }>().error.code).toBe(
            'AUTHORIZATION_PROTECTED_ROLE',
          );
        }
        for (const roleIds of [['4'], ['99999']])
          expect(
            (
              await app.inject({
                method: 'POST',
                url,
                headers,
                payload: { ...valid, roleIds },
              })
            ).statusCode,
          ).toBe(404);
        for (const path of [
          `${base}/employees/9007199254740992/roles`,
          `${base}/roles/2/employees?limit=101`,
          `${base}/roles/2/employees?unknown=1`,
        ])
          expect(
            (await app.inject({ method: 'GET', url: path, headers }))
              .statusCode,
          ).toBe(400);
        expect(
          (
            await app.inject({
              method: 'GET',
              url: `${base}/employees/99999/roles`,
              headers,
            })
          ).statusCode,
        ).toBe(404);
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/api/authorization/modules/unknown/employee-role-assignments',
              headers,
              payload: valid,
            })
          ).statusCode,
        ).toBe(400);
      } finally {
        await app.close();
      }
    });
  } finally {
    await portal.drop();
  }
});

it('API與REPL同CAS語意，兩實例舊會話立即撤權，撤後重授恢復同列', async () => {
  const portal = await createSyntheticPortal();
  try {
    await portal.insertPeople([
      { person_empid: 'AZCAS', person_name: '合成CAS員工', person_status: 1 },
    ]);
    await withAuthorizationDatabase(async (db) => {
      const { catalog } = await initializeAuthorizationOperator(db);
      await catalog.syncCatalog();
      const other = await new DataSource(db.options).initialize();
      const a = await createAuthorizationHttpApp(db),
        b = await createAuthorizationHttpApp(other);
      const consoleApp = await Test.createTestingModule({
        imports: [ConsoleModule],
      })
        .overrideProvider(MYSQL_MAIN)
        .useValue(db)
        .compile();
      try {
        await consoleApp.init();
        const authz = createAuthorizationConsole(consoleApp);
        const cookie = await createAuthorizationSession(a, {
            kind: 'super_user',
          }),
          headers = { cookie, origin: 'http://localhost:3000' };
        const payload = {
          empId: 'AZCAS',
          roleIds: ['2', '3'],
          expectedRoleIds: [],
        };
        const initial = await authz.assignRoles('esign', payload);
        expect(initial.changed).toBe(true);
        expect(
          await authz.employeeRoles('esign', initial.userId),
        ).toMatchObject({
          roleIds: ['2', '3'],
          implicitRoles: [{ roleCode: 'colleague', source: 'baseline' }],
        });
        const employee = await createAuthorizationSession(a, {
          kind: 'employee',
          userId: Number(initial.userId),
        });
        const read = async (hasCreate: boolean) => {
          for (const app of [a, b]) {
            const response = await app.inject({
              method: 'GET',
              url: '/api/me/authorization',
              headers: { cookie: employee },
            });
            expect(response.statusCode).toBe(200);
            const keys = response.json<{
              data: { modules: Array<{ permissions: string[] }> };
            }>().data.modules[0].permissions;
            expect(keys.includes('esign.document.create')).toBe(hasCreate);
            expect(keys).toContain('esign.signing.submit');
          }
        };
        await read(true);
        const firstIds = await db.query<Array<{ id: number; role_id: number }>>(
          'SELECT id,role_id FROM authorization_user_roles WHERE user_id=? ORDER BY role_id',
          [initial.userId],
        );
        const replace = async (
          roleIds: string[],
          expectedRoleIds: string[],
          status = 200,
        ) => {
          const response = await a.inject({
            method: 'POST',
            url: `${base}/employee-role-assignments`,
            headers,
            payload: { empId: 'AZCAS', roleIds, expectedRoleIds },
          });
          expect(response.statusCode).toBe(status);
          return response;
        };
        await replace(['2'], ['2', '3']);
        await read(true);
        await replace([], ['2', '3'], 409);
        await read(true);
        await replace([], ['2']);
        await read(false);
        expect(
          (await replace([], ['3'])).json<{ data: AssignmentView }>().data
            .changed,
        ).toBe(false);
        await authz.assignRoles('esign', {
          empId: 'AZCAS',
          roleIds: ['3', '2'],
          expectedRoleIds: [],
        });
        await read(true);
        expect(
          await db.query(
            'SELECT id,role_id FROM authorization_user_roles WHERE user_id=? ORDER BY role_id',
            [initial.userId],
          ),
        ).toEqual(firstIds);
        await authz.updateRole('esign', '2', {
          isActive: false,
          expectedVersion: 1,
        });
        await read(true); // 管理員的重複 grant 仍然有效。
        await authz.assignRoles('esign', {
          empId: 'AZCAS',
          roleIds: ['2'],
          expectedRoleIds: ['2', '3'],
        });
        await read(false);
        expect(
          (await authz.employeeRoles('esign', initial.userId)).roleIds,
        ).toEqual(['2']);
        await authz.updateRole('esign', '2', {
          isActive: true,
          expectedVersion: 2,
        });
        await read(true);
        await authz.setRolePermissions('esign', '2', {
          permissionKeys: ['esign.export.read'],
          expectedVersion: 3,
        });
        await read(false);
        const events = await authz.events({ limit: 100 });
        const changes = events.items.filter(
          (e) => e.eventType === 'user.roles_updated',
        );
        expect(changes).toHaveLength(5);
        expect(
          changes.some(
            (e) => e.source === 'http' && e.actorKind === 'super_user',
          ),
        ).toBe(true);
        expect(
          changes.some(
            (e) => e.source === 'repl' && e.actorKind === 'operator',
          ),
        ).toBe(true);
        await expect(
          authz.assignRoles('esign', {
            empId: 'AZCAS',
            roleIds: [],
            expectedRoleIds: ['3'],
          }),
        ).rejects.toMatchObject({ code: 'AUTHORIZATION_VERSION_CONFLICT' });
        await db.query(
          'UPDATE super_user_access SET active_credential_fingerprint=? WHERE id=1',
          ['0'.repeat(64)],
        );
        await expect(
          authz.assignRoles('esign', {
            empId: 'AZCAS',
            roleIds: [],
            expectedRoleIds: ['2'],
          }),
        ).rejects.toMatchObject({ code: 'AUTH_SUPER_USER_UNAVAILABLE' });
      } finally {
        await consoleApp.close();
        await a.close();
        await b.close();
        if (other.isInitialized) await other.destroy();
      }
    });
  } finally {
    await portal.drop();
  }
});

it('正式AppModule可預指派且成員cursor分頁只回本地ID與姓名', async () => {
  const portal = await createSyntheticPortal();
  try {
    await portal.insertPeople(
      [1, 2, 3].map((i) => ({
        person_empid: `AZPAGE${i}`,
        person_name: `合成分頁${i}`,
        person_status: 1,
      })),
    );
    await withAuthorizationDatabase(async (db) => {
      const { catalog } = await initializeAuthorizationOperator(db);
      await catalog.syncCatalog();
      const ctx = await createSecurityE2eApp(
        (builder) => builder.overrideProvider(MYSQL_MAIN).useValue(db),
        null,
      );
      try {
        const cookie = await createAuthorizationSession(ctx.app, {
            kind: 'super_user',
          }),
          headers = { cookie, origin: 'http://localhost:3000' };
        const ids: string[] = [];
        for (const i of [1, 2, 3]) {
          const assigned = await ctx.app.inject({
            method: 'POST',
            url: `${base}/employee-role-assignments`,
            headers,
            payload: {
              empId: `AZPAGE${i}`,
              roleIds: ['2'],
              expectedRoleIds: [],
            },
          });
          expect(assigned.statusCode).toBe(200);
          ids.push(assigned.json<{ data: AssignmentView }>().data.userId);
        }
        const visited: string[] = [];
        let next: string | null = null;
        do {
          const response = await ctx.app.inject({
            method: 'GET',
            url: `${base}/roles/2/employees?limit=1${next ? `&beforeId=${next}` : ''}`,
            headers,
          });
          expect(response.statusCode).toBe(200);
          expect(response.headers['cache-control']).toBe('no-store');
          const page: {
            items: Array<{ userId: string; name: string }>;
            nextCursor: string | null;
          } = response.json<{
            data: {
              items: Array<{ userId: string; name: string }>;
              nextCursor: string | null;
            };
          }>().data;
          expect(page.items).toHaveLength(1);
          expect(Object.keys(page.items[0]).sort()).toEqual(['name', 'userId']);
          visited.push(page.items[0].userId);
          next = page.nextCursor;
        } while (next);
        expect(visited).toEqual([...ids].reverse());
        expect(
          await db.query<Array<{ lastLoginAt: Date | null }>>(
            'SELECT last_login_at AS lastLoginAt FROM users ORDER BY id',
          ),
        ).toEqual([
          { lastLoginAt: null },
          { lastLoginAt: null },
          { lastLoginAt: null },
        ]);
      } finally {
        await closeSecurityE2eApp(ctx);
      }
    });
  } finally {
    await portal.drop();
  }
});
