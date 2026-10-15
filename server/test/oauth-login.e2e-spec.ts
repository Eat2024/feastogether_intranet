import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { OauthClient } from '#app/infrastructure/http-client/oauth/oauth.client';
import { apiData } from './api-response.helper';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

/** 只替換上游 OIDC 網路；正式 AuthModule、Redis 交易、MySQL session 與 guard 全部實際執行。 */
describe('OAuth 登入 HTTP 整合', () => {
  const empid = 'E2EOAUTHLOGIN';
  let ctx: SecurityE2eContext;
  let db: DataSource;

  beforeAll(async () => {
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(OauthClient).useValue({
        createLoginChallenge: () => ({
          state: randomUUID(),
          nonce: randomUUID(),
        }),
        buildAuthorizationUrl: ({ state }: { state: string }) =>
          Promise.resolve(`https://auth.example.test/authorize?state=${state}`),
        exchangeCode: () =>
          Promise.resolve({
            accessToken: 'synthetic-provider-token',
            sub: 'synthetic-sub',
          }),
        fetchUserInfo: () =>
          Promise.resolve({
            sub: 'synthetic-sub',
            userNumber: empid,
            name: '登入測試員工',
          }),
      }),
    );
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
  });

  afterAll(async () => {
    if (!ctx) return;
    await db.query(
      'DELETE FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE empid = ?)',
      [empid],
    );
    await db.query('DELETE FROM users WHERE empid = ?', [empid]);
    await closeSecurityE2eApp(ctx);
  });

  it('登入、瀏覽器綁定、重放拒絕與 session 到期', async () => {
    const started = await request(ctx.server)
      .post('/api/auth/oauth/start')
      .set('Origin', 'http://localhost:3000')
      .send({ redirectTo: '/forms/42' })
      .expect(200);
    const state = new URL(
      apiData<{ authorizationUrl: string }>(started).authorizationUrl,
    ).searchParams.get('state');
    const rawCookies: unknown = started.headers['set-cookie'];
    if (!Array.isArray(rawCookies) || typeof rawCookies[0] !== 'string')
      throw new Error('缺少交易 cookie');
    const txCookie = rawCookies[0].split(';')[0];
    expect(txCookie).toMatch(/^FT_ESIGN_OAUTH_TX=/);
    const callback = { state, code: 'synthetic-code' };
    await request(ctx.server)
      .post('/api/auth/oauth/callback')
      .set('Origin', 'http://localhost:3000')
      .send(callback)
      .expect(400);
    const completed = await request(ctx.server)
      .post('/api/auth/oauth/callback')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', txCookie)
      .send(callback)
      .expect(200);
    expect(apiData<{ redirectTo: string }>(completed).redirectTo).toBe(
      '/forms/42',
    );
    expect(completed.text).not.toContain('synthetic-provider-token');
    const cookies: unknown = completed.headers['set-cookie'];
    if (!Array.isArray(cookies)) throw new Error('缺少登入 cookie');
    const cookie: unknown = cookies.find(
      (value: unknown) =>
        typeof value === 'string' && value.startsWith('FT_ESIGN_SESSION='),
    );
    if (typeof cookie !== 'string') throw new Error('缺少登入 cookie');
    expect(cookie).toContain('HttpOnly');
    await request(ctx.server)
      .get('/api/auth/session')
      .set('Cookie', cookie.split(';')[0])
      .expect(200);
    await request(ctx.server)
      .post('/api/auth/oauth/callback')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', txCookie)
      .send(callback)
      .expect(400);
    await db.query(
      'UPDATE auth_sessions SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE user_id = (SELECT id FROM users WHERE empid = ?)',
      [empid],
    );
    await request(ctx.server)
      .get('/api/auth/session')
      .set('Cookie', cookie.split(';')[0])
      .expect(401);
  });

  it('跨站發起登入會被拒絕', async () => {
    await request(ctx.server)
      .post('/api/auth/oauth/start')
      .set('Origin', 'https://evil.test')
      .send({})
      .expect(403);
  });
});
