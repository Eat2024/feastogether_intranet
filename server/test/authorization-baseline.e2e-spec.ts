import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
} from './security-e2e.helper';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import {
  withAuthorizationDatabase,
  initializeAuthorizationOperator,
} from './helpers/authorization-fixtures';
import {
  createAuthorizationHttpApp,
  createAuthorizationSession,
} from './helpers/authorization-http-fixtures';

describe('028 本人有效能力契約', () => {
  jest.setTimeout(120_000);
  it('既有及新 OAuth/WebView session 無指派也有同仁，缺部門不影響能力，GET 不寫入', async () => {
    await withAuthorizationDatabase(async (db) => {
      const { catalog } = await initializeAuthorizationOperator(db);
      await db.query(
        "INSERT INTO users (empid,name) VALUES ('AZ-OLD','合成舊員工'),('AZ-NEW','合成新員工')",
      );
      const app = await createAuthorizationHttpApp(db);
      try {
        const oldCookie = await createAuthorizationSession(
          app,
          { kind: 'employee', userId: 1 },
          'oauth',
        );
        expect(
          (
            await app.inject({
              method: 'GET',
              url: '/api/me/authorization',
              headers: { cookie: oldCookie },
            })
          ).statusCode,
        ).toBe(503);
        await catalog.syncCatalog();
        const newCookie = await createAuthorizationSession(
          app,
          { kind: 'employee', userId: 2 },
          'webview',
        );
        for (const [cookie, userId] of [
          [oldCookie, 1],
          [newCookie, 2],
        ] as const) {
          const response = await app.inject({
            method: 'GET',
            url: '/api/me/authorization',
            headers: { cookie },
          });
          expect(response.statusCode).toBe(200);
          expect(response.headers['cache-control']).toBe('no-store');
          expect(response.json<{ data: unknown }>().data).toEqual({
            actor: { kind: 'employee', userId },
            modules: [
              {
                moduleKey: 'esign',
                permissions: [
                  'esign.document.read',
                  'esign.signing.copy',
                  'esign.signing.read',
                  'esign.signing.submit',
                ],
              },
            ],
          });
        }
        expect(
          await db.query(
            'SELECT COUNT(*) AS total FROM authorization_user_roles',
          ),
        ).toEqual([{ total: 0 }]);
      } finally {
        await app.close();
      }
    });
  });
});

it('未登入401，停用／刪除員工舊session無效；Super最小身分與全部目錄，不能自動進入未相容業務', async () => {
  await withAuthorizationDatabase(async (db) => {
    const { catalog } = await initializeAuthorizationOperator(db);
    await catalog.syncCatalog();
    await db.query(
      "INSERT INTO users (empid,name) VALUES ('AZ-DISABLED','合成員工'),('AZ-DELETED','合成刪除員工')",
    );
    const app = await createAuthorizationHttpApp(db);
    try {
      expect(
        (await app.inject({ method: 'GET', url: '/api/me/authorization' }))
          .statusCode,
      ).toBe(401);
      const cookie = await createAuthorizationSession(app, {
        kind: 'employee',
        userId: 1,
      });
      const deletedCookie = await createAuthorizationSession(app, {
        kind: 'employee',
        userId: 2,
      });
      await db.query('UPDATE users SET is_active=0 WHERE id=1');
      await db.query('UPDATE users SET deleted_at=NOW(6) WHERE id=2');
      for (const token of [cookie, deletedCookie])
        expect(
          (
            await app.inject({
              method: 'GET',
              url: '/api/me/authorization',
              headers: { cookie: token },
            })
          ).statusCode,
        ).toBe(401);
      const superCookie = await createAuthorizationSession(app, {
        kind: 'super_user',
      });
      const response = await app.inject({
        method: 'GET',
        url: '/api/me/authorization',
        headers: { cookie: superCookie },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const body = response.json<{
        data: {
          actor: unknown;
          modules: Array<{ moduleKey: string; permissions: string[] }>;
        };
      }>().data;
      expect(body.actor).toEqual({
        kind: 'super_user',
        displayName: 'Super user',
      });
      expect(Object.keys(body)).toEqual(['actor', 'modules']);
      expect(body.modules.map((m) => m.moduleKey)).toEqual([
        'esign',
        'platform',
      ]);
      expect(body.modules.flatMap((m) => m.permissions)).toHaveLength(12);
      await db.query(
        "UPDATE authorization_permissions SET deleted_at=NOW(6) WHERE permission_key='esign.export.create'",
      );
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/me/authorization',
            headers: { cookie: superCookie },
          })
        ).statusCode,
      ).toBe(503);
    } finally {
      await app.close();
    }
  });
});

it('正式 AppModule 的全域 guard 順序可讀本人能力且不開放 Super 本人簽署', async () => {
  await withAuthorizationDatabase(async (db) => {
    const { catalog } = await initializeAuthorizationOperator(db);
    await catalog.syncCatalog();
    await db.query(
      "INSERT INTO users (empid,name) VALUES ('AZ-APP','合成應用員工')",
    );
    const ctx = await createSecurityE2eApp(
      (builder) => builder.overrideProvider(MYSQL_MAIN).useValue(db),
      null,
    );
    try {
      const cookie = await createAuthorizationSession(ctx.app, {
        kind: 'employee',
        userId: 1,
      });
      expect(
        (
          await ctx.app.inject({
            method: 'GET',
            url: '/api/me/authorization',
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(200);
      const superCookie = await createAuthorizationSession(ctx.app, {
        kind: 'super_user',
      });
      expect(
        (
          await ctx.app.inject({
            method: 'GET',
            url: '/api/me/authorization',
            headers: { cookie: superCookie },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await ctx.app.inject({
            method: 'GET',
            url: '/api/esign/signing-tasks',
            headers: { cookie: superCookie },
          })
        ).statusCode,
      ).toBe(403);
      await db.query(
        'RENAME TABLE authorization_permissions TO authorization_permissions_unavailable',
      );
      try {
        const response = await ctx.app.inject({
          method: 'GET',
          url: '/api/me/authorization',
          headers: { cookie },
        });
        expect(response.statusCode).toBe(503);
        expect(response.json<{ error: { code: string } }>().error.code).toBe(
          'AUTHORIZATION_UNAVAILABLE',
        );
      } finally {
        await db.query(
          'RENAME TABLE authorization_permissions_unavailable TO authorization_permissions',
        );
      }
    } finally {
      await closeSecurityE2eApp(ctx);
    }
  });
});
