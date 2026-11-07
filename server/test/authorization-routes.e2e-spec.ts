import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
} from './security-e2e.helper';
import {
  EXPECTED_ROUTES,
  PUBLIC_RESPONSES,
} from './helpers/authorization-route-matrix';
import { createAuthorizationSession } from './helpers/authorization-http-fixtures';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { User } from '#app/features/users/entities/user.entity';

jest.setTimeout(120_000);
const missingId = '999999999';
function urlFor(route: string) {
  return route
    .replace(':moduleKey', 'esign')
    .replace(
      /:(jobId|exportId|batchId|signerPublicId)/g,
      '00000000-0000-4000-8000-000000000000',
    )
    .replace(':token', 'A'.repeat(43))
    .replace(':entryKey', 'A'.repeat(43))
    .replace(/:[A-Za-z]+/g, missingId)
    .replace('*', 'missing');
}
function isProtected(method: string, url: string) {
  return (
    url.startsWith('/api/esign/') ||
    url.startsWith('/api/authorization/') ||
    url === '/api/me/authorization' ||
    (method === 'GET' && url === '/api/auth/session')
  );
}
function needsExtraGrant(method: string, url: string) {
  if (url.startsWith('/api/authorization/')) return true;
  if (
    url.includes('signer-candidates') ||
    url.includes('initiation-jobs') ||
    url.includes('notification-batches') ||
    url.includes('exports') ||
    url.includes('exportable-documents') ||
    url.includes('export-downloads') ||
    url.includes('/history/export') ||
    url.includes('reopening-invitations')
  )
    return true;
  return (
    url.startsWith('/api/esign/documents') &&
    method !== 'GET' &&
    !url.includes('completed-file/downloads')
  );
}
it('實際註冊全部路徑與獨立矩陣相符，逐路由驗401與無能力403；Public例外保留自身憑證邊界', async () => {
  const routes: string[] = [];
  const ctx = await createSecurityE2eApp(undefined, [], (app) => {
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onRoute', (route) => {
        for (const method of [route.method].flat())
          if (method !== 'HEAD') routes.push(`${method} ${route.url}`);
      });
  });
  const manager = ctx.app.get(MysqlService).getManager();
  const user = await manager.save(
    User,
    manager.create(User, {
      empid: `AZ-MATRIX-${Date.now()}`,
      name: '合成一般同仁',
      isActive: true,
      departmentCode: 'AZ-MATRIX',
    }),
  );
  try {
    expect([...routes].sort()).toEqual([...EXPECTED_ROUTES].sort());
    const cookie = await createAuthorizationSession(ctx.app, {
      kind: 'employee',
      userId: user.id,
    });
    for (const route of routes) {
      const [method, pattern] = route.split(' ');
      const url = urlFor(pattern);
      const options = {
        method,
        url,
        headers: { origin: 'http://localhost:3000' },
      };
      const anonymous = await ctx.app.inject(options);
      if (isProtected(method, pattern)) {
        expect({ route, status: anonymous.statusCode }).toEqual({
          route,
          status: 401,
        });
        if (needsExtraGrant(method, pattern)) {
          const denied = await ctx.app.inject({
            ...options,
            headers: { ...options.headers, cookie },
          });
          expect({ route, status: denied.statusCode }).toEqual({
            route,
            status: 403,
          });
          expect(denied.headers['set-cookie']).toBeUndefined();
        }
      } else {
        expect({ route, status: anonymous.statusCode }).toEqual({
          route,
          status: PUBLIC_RESPONSES[route],
        });
        expect(anonymous.body).not.toContain('AUTHORIZATION_DENIED');
      }
    }
    for (const url of [
      '/api/esign/documents/999999999',
      '/api/esign/documents/999999999/source-file',
      '/api/esign/signing-tasks/00000000-0000-4000-8000-000000000000/source-file',
    ]) {
      expect(
        (await ctx.app.inject({ method: 'GET', url, headers: { cookie } }))
          .statusCode,
      ).toBe(404);
    }
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/api/auth/session',
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
    for (const staleCookie of ['', 'FT_ESIGN_SESSION=stale']) {
      expect(
        (
          await ctx.app.inject({
            method: 'DELETE',
            url: '/api/auth/session',
            headers: { origin: 'http://localhost:3000', cookie: staleCookie },
          })
        ).statusCode,
      ).toBe(200);
    }
    expect(
      (
        await ctx.app.inject({
          method: 'DELETE',
          url: '/api/auth/session',
          headers: { origin: 'https://untrusted.invalid' },
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    await manager.query('DELETE FROM auth_sessions WHERE user_id=?', [user.id]);
    await manager.delete(User, { id: user.id });
    await closeSecurityE2eApp(ctx);
  }
});
