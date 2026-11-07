import { Test } from '@nestjs/testing';
import { ConsoleModule } from '#app/console/console.module';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { createAuthorizationConsole } from '#app/console/helpers/authorization.helpers';
import {
  withAuthorizationDatabase,
  initializeAuthorizationOperator,
} from './helpers/authorization-fixtures';
import {
  createAuthorizationHttpApp,
  createAuthorizationSession,
} from './helpers/authorization-http-fixtures';

describe('028 Super 角色管理', () => {
  jest.setTimeout(120_000);
  it('Super 可建立與讀回角色，員工拒絕且寫入要求同源', async () => {
    await withAuthorizationDatabase(async (db) => {
      const { catalog } = await initializeAuthorizationOperator(db);
      await catalog.syncCatalog();
      await db.query(
        "INSERT INTO users (empid,name) VALUES ('AZ-MANAGER','合成管理測試員工')",
      );
      const app = await createAuthorizationHttpApp(db);
      try {
        const cookie = await createAuthorizationSession(app, {
          kind: 'super_user',
        });
        const employee = await createAuthorizationSession(app, {
          kind: 'employee',
          userId: 1,
        });
        const url = '/api/authorization/modules/esign/roles';
        await db.query(
          "INSERT INTO authorization_user_roles(user_id,module_key,role_id) SELECT 1,'esign',id FROM authorization_roles WHERE role_code='esign_admin'",
        );
        for (const [method, path] of [
          ['GET', '/api/authorization/modules'],
          ['GET', `${url}/1`],
          ['GET', '/api/authorization/modules/esign/permissions'],
          ['POST', url],
          ['PATCH', `${url}/1`],
          ['DELETE', `${url}/1`],
          ['PUT', `${url}/1/permissions`],
          ['GET', '/api/authorization/events'],
        ] as const) {
          expect(
            (
              await app.inject({
                method,
                url: path,
                headers: { cookie: employee, origin: 'http://localhost:3000' },
              })
            ).statusCode,
          ).toBe(403);
          expect(
            (
              await app.inject({
                method,
                url: path,
                headers: { origin: 'http://localhost:3000' },
              })
            ).statusCode,
          ).toBe(401);
        }

        expect(
          (
            await app.inject({
              method: 'GET',
              url,
              headers: { cookie: employee },
            })
          ).statusCode,
        ).toBe(403);
        expect(
          (
            await app.inject({
              method: 'POST',
              url,
              headers: { cookie },
              payload: { roleName: '角色' },
            })
          ).statusCode,
        ).toBe(403);
        const response = await app.inject({
          method: 'POST',
          url,
          headers: { cookie, origin: 'http://localhost:3000' },
          payload: { roleName: '  合成角色  ' },
        });
        expect(response.statusCode).toBe(201);
        expect(response.headers['cache-control']).toBe('no-store');
        const role = response.json<{
          data: {
            id: string;
            roleCode: string;
            roleName: string;
            version: number;
            permissionKeys: string[];
          };
        }>().data;
        expect(role).toMatchObject({
          roleName: '合成角色',
          version: 1,
          permissionKeys: [],
        });
        expect(typeof role.id).toBe('string');
        expect(
          (
            await app.inject({
              method: 'GET',
              url: `${url}/${role.id}`,
              headers: { cookie },
            })
          ).json<{ data: unknown }>().data,
        ).toEqual(role);
      } finally {
        await app.close();
      }
    });
  });
});

it('角色變更採版本CAS、無變更不加版，刪除與權限異動可由audit追查', async () => {
  await withAuthorizationDatabase(async (db) => {
    const { catalog } = await initializeAuthorizationOperator(db);
    await catalog.syncCatalog();
    const app = await createAuthorizationHttpApp(db);
    try {
      const cookie = await createAuthorizationSession(app, {
        kind: 'super_user',
      });
      const headers = { cookie, origin: 'http://localhost:3000' };
      const base = '/api/authorization/modules/esign/roles';
      const created = await app.inject({
        method: 'POST',
        url: base,
        headers,
        payload: { roleName: '版本角色' },
      });
      const role = created.json<{ data: { id: string; roleCode: string } }>()
        .data;
      const url = `${base}/${role.id}`;
      const update = await app.inject({
        method: 'PATCH',
        url,
        headers,
        payload: { roleName: '更新角色', isActive: false, expectedVersion: 1 },
      });
      expect(update.statusCode).toBe(200);
      expect(update.json<{ data: unknown }>().data).toMatchObject({
        roleName: '更新角色',
        isActive: false,
        version: 2,
        roleCode: role.roleCode,
      });
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url,
            headers,
            payload: { roleName: '過期', expectedVersion: 1 },
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url,
            headers,
            payload: { isActive: false, expectedVersion: 2 },
          })
        ).json<{ data: { version: number } }>().data.version,
      ).toBe(2);
      const permissions = await app.inject({
        method: 'PUT',
        url: `${url}/permissions`,
        headers,
        payload: { permissionKeys: ['esign.export.read'], expectedVersion: 2 },
      });
      expect(permissions.statusCode).toBe(200);
      expect(permissions.json<{ data: unknown }>().data).toMatchObject({
        version: 3,
        permissionKeys: ['esign.export.read'],
      });
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `${url}?expectedVersion=3`,
            headers,
          })
        ).statusCode,
      ).toBe(204);
      expect(
        (await app.inject({ method: 'GET', url, headers })).statusCode,
      ).toBe(404);
      const events = await app.inject({
        method: 'GET',
        url: '/api/authorization/events?limit=100',
        headers,
      });
      expect(events.statusCode).toBe(200);
      const rows = events
        .json<{
          data: {
            items: Array<{
              targetId: string;
              eventType: string;
              actorKind: string;
              source: string;
              after: unknown;
            }>;
          };
        }>()
        .data.items.filter((x) => x.targetId === role.id);
      expect(rows.map((x) => x.eventType)).toEqual([
        'role.deleted',
        'role.permissions_updated',
        'role.updated',
        'role.created',
      ]);
      expect(
        rows.every((x) => x.actorKind === 'super_user' && x.source === 'http'),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });
});

it('保護同仁、維護專用能力與嚴格輸入，列表及稽核分頁不漏資料', async () => {
  await withAuthorizationDatabase(async (db) => {
    const { catalog } = await initializeAuthorizationOperator(db);
    await catalog.syncCatalog();
    const app = await createAuthorizationHttpApp(db);
    try {
      const cookie = await createAuthorizationSession(app, {
          kind: 'super_user',
        }),
        headers = { cookie, origin: 'http://localhost:3000' },
        base = '/api/authorization/modules/esign/roles';
      const call = (
        method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
        url: string,
        payload?: object,
      ) => app.inject({ method, url, headers, payload });
      for (const payload of [
        { roleName: '' },
        { roleName: '  ' },
        { roleName: 'x'.repeat(101) },
        { roleName: 3 },
        { roleName: 'x', isProtected: false },
        { roleName: 'x', roleCode: 'chosen' },
      ]) {
        const result = await call('POST', base, payload);
        expect(result.statusCode).toBe(400);
        expect(result.json<{ error: { code: string } }>().error.code).toBe(
          'REQUEST_FORMAT_INVALID',
        );
      }
      const page = (await call('GET', `${base}?limit=1`)).json<{
        data: { items: Array<{ id: string }>; nextCursor: string };
      }>().data;
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBe(page.items[0].id);
      const second = (
        await call('GET', `${base}?limit=1&beforeId=${page.nextCursor}`)
      ).json<{ data: { items: Array<{ id: string }> } }>().data;
      expect(second.items[0].id).not.toBe(page.items[0].id);
      for (const suffix of [
        '?limit=101',
        '?beforeId=9007199254740992',
        '?other=secret',
        '?limit=1.5',
        '?limit=0',
      ])
        expect((await call('GET', base + suffix)).statusCode).toBe(400);
      const roles = (await call('GET', base)).json<{
        data: { items: Array<{ id: string; roleCode: string }> };
      }>().data.items;
      const protectedId = roles.find((r) => r.roleCode === 'colleague')!.id;
      for (const [method, url, payload] of [
        [
          'PATCH',
          `${base}/${protectedId}`,
          { roleName: '改名', expectedVersion: 1 },
        ],
        [
          'PUT',
          `${base}/${protectedId}/permissions`,
          { permissionKeys: [], expectedVersion: 1 },
        ],
        ['DELETE', `${base}/${protectedId}?expectedVersion=1`, undefined],
      ] as const) {
        const response = await call(method, url, payload);
        expect(response.statusCode).toBe(403);
        expect(response.json<{ error: { code: string } }>().error.code).toBe(
          'AUTHORIZATION_PROTECTED_ROLE',
        );
      }
      expect(
        (
          await call('POST', '/api/authorization/modules/platform/roles', {
            roleName: '維護',
          })
        ).statusCode,
      ).toBe(403);
      const role = (await call('POST', base, { roleName: '權限角色' })).json<{
        data: { id: string };
      }>().data;
      const url = `${base}/${role.id}`;
      for (const payload of [
        { expectedVersion: 1 },
        { expectedVersion: '1', roleName: 'x' },
        { expectedVersion: 1, isActive: null },
        { expectedVersion: 1, isActive: 'false' },
      ])
        expect((await call('PATCH', url, payload)).statusCode).toBe(400);
      for (const permissionKeys of [
        ['esign.document.read-all'],
        ['esign.document.manage-all'],
        ['esign.export.all'],
        ['unknown'],
        ['esign.document.read', 'esign.document.read'],
        Array(101).fill('esign.document.read'),
      ])
        expect(
          (
            await call('PUT', `${url}/permissions`, {
              permissionKeys,
              expectedVersion: 1,
            })
          ).statusCode,
        ).toBe(400);
      expect(
        (
          await call('PUT', `${url}/permissions`, {
            permissionKeys: ['platform.authorization.manage'],
            expectedVersion: 1,
          })
        ).statusCode,
      ).toBe(403);
      expect((await call('GET', `${base}/9007199254740992`)).statusCode).toBe(
        400,
      );
      expect(
        (
          await call(
            'GET',
            `/api/authorization/modules/platform/roles/${role.id}`,
          )
        ).statusCode,
      ).toBe(404);
      const events = await call('GET', '/api/authorization/events?limit=1');
      const eventPage = events.json<{
        data: { items: unknown[]; nextCursor: string };
      }>().data;
      expect(eventPage.items).toHaveLength(1);
      expect(eventPage.nextCursor).toMatch(/^[1-9][0-9]*$/);
      expect(
        (await call('GET', '/api/authorization/modules')).json<{
          data: unknown;
        }>().data,
      ).toEqual([
        { moduleKey: 'esign', name: '電子簽' },
        { moduleKey: 'platform', name: '平台' },
      ]);
      expect(
        (
          await call('GET', '/api/authorization/modules/platform/permissions')
        ).json<{ data: unknown }>().data,
      ).toEqual([
        {
          moduleKey: 'platform',
          permissionKey: 'platform.authorization.manage',
          name: '管理授權',
          assignable: false,
        },
      ]);
    } finally {
      await app.close();
    }
  });
});

it('並發同名與同版本只成功一次；使用中刪除拒絕，audit故障完全回滾', async () => {
  await withAuthorizationDatabase(async (db) => {
    const { catalog } = await initializeAuthorizationOperator(db);
    await catalog.syncCatalog();
    await db.query(
      "INSERT INTO users(empid,name) VALUES('AZ-BOUND','合成指派員工')",
    );
    const app = await createAuthorizationHttpApp(db);
    try {
      const cookie = await createAuthorizationSession(app, {
          kind: 'super_user',
        }),
        headers = { cookie, origin: 'http://localhost:3000' },
        base = '/api/authorization/modules/esign/roles';
      const responses = await Promise.all(
        [1, 2].map(() =>
          app.inject({
            method: 'POST',
            url: base,
            headers,
            payload: { roleName: '競爭名稱' },
          }),
        ),
      );
      expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      const role = responses
        .find((r) => r.statusCode === 201)!
        .json<{ data: { id: string } }>().data;
      const url = `${base}/${role.id}`;
      const updates = await Promise.all(
        ['版本甲', '版本乙'].map((roleName) =>
          app.inject({
            method: 'PATCH',
            url,
            headers,
            payload: { roleName, expectedVersion: 1 },
          }),
        ),
      );
      expect(updates.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      await db.query(
        'INSERT INTO authorization_user_roles(user_id,module_key,role_id) VALUES(1,?,?)',
        ['esign', role.id],
      );
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `${url}?expectedVersion=2`,
            headers,
          })
        ).statusCode,
      ).toBe(409);
      const before = (await app.inject({ method: 'GET', url, headers })).json<{
        data: unknown;
      }>().data;
      await db.query(
        "CREATE TRIGGER reject_authorization_audit BEFORE INSERT ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='合成稽核故障'",
      );
      const failed = await app.inject({
        method: 'PATCH',
        url,
        headers,
        payload: { roleName: '不應寫入', expectedVersion: 2 },
      });
      expect(failed.statusCode).toBe(503);
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `${url}/permissions`,
            headers,
            payload: {
              permissionKeys: ['esign.document.read'],
              expectedVersion: 2,
            },
          })
        ).statusCode,
      ).toBe(503);

      expect(
        (await app.inject({ method: 'GET', url, headers })).json<{
          data: unknown;
        }>().data,
      ).toEqual(before);
      await db.query('DROP TRIGGER reject_authorization_audit');
    } finally {
      await app.close();
    }
  });
});

it('REPL與HTTP共用嚴格輸入、版本、角色資料及audit，過期維護設定禁止異動', async () => {
  await withAuthorizationDatabase(async (db) => {
    const { catalog } = await initializeAuthorizationOperator(db);
    await catalog.syncCatalog();
    const consoleApp = await Test.createTestingModule({
      imports: [ConsoleModule],
    })
      .overrideProvider(MYSQL_MAIN)
      .useValue(db)
      .compile();
    const app = await createAuthorizationHttpApp(db);
    try {
      await consoleApp.init();
      const authz = createAuthorizationConsole(consoleApp);
      const role = await authz.createRole('esign', {
        roleName: '  維運角色  ',
      });
      expect(role.roleName).toBe('維運角色');
      const cookie = await createAuthorizationSession(app, {
          kind: 'super_user',
        }),
        headers = { cookie, origin: 'http://localhost:3000' },
        url = `/api/authorization/modules/esign/roles/${role.id}`;
      expect(
        (await app.inject({ method: 'GET', url, headers })).json<{
          data: unknown;
        }>().data,
      ).toEqual(role);
      const assigned = await authz.setRolePermissions('esign', role.id, {
        permissionKeys: ['esign.document.read', 'esign.document.read-all'],
        expectedVersion: 1,
      });
      expect(assigned.version).toBe(2);
      expect(
        await authz.setRolePermissions('esign', role.id, {
          permissionKeys: ['esign.document.read-all', 'esign.document.read'],
          expectedVersion: 2,
        }),
      ).toEqual(assigned);

      await expect(
        authz.updateRole('esign', role.id, {
          roleName: '過期',
          expectedVersion: 1,
        }),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_VERSION_CONFLICT' });
      await expect(
        authz.createRole('esign', { roleName: 'x', isProtected: true }),
      ).rejects.toMatchObject({ code: 'REQUEST_FORMAT_INVALID' });
      expect(await authz.rolePermissions('esign', role.id)).toEqual(assigned);
      const events = await authz.events({ limit: 100 });
      expect(events.items.filter((e) => e.targetId === role.id)).toHaveLength(
        2,
      );
      expect(
        events.items
          .filter((e) => e.targetId === role.id)
          .every((e) => e.actorKind === 'operator' && e.source === 'repl'),
      ).toBe(true);
      await authz.deleteRole('esign', role.id, 2);
      await expect(
        authz.rolePermissions('esign', role.id),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_RESOURCE_NOT_FOUND' });
      await db.query(
        'UPDATE super_user_access SET active_credential_fingerprint=? WHERE id=1',
        ['0'.repeat(64)],
      );
      await expect(
        authz.createRole('esign', { roleName: '不應建立' }),
      ).rejects.toMatchObject({ code: 'AUTH_SUPER_USER_UNAVAILABLE' });
    } finally {
      await consoleApp.close();
      await app.close();
    }
  });
});
