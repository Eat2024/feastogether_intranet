import request from 'supertest';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

describe('runtime API coverage', () => {
  let ctx: SecurityE2eContext;

  beforeAll(async () => {
    ctx = await createSecurityE2eApp();
  });

  afterAll(async () => closeSecurityE2eApp(ctx));

  it('health 是明確 Public 例外且不需要 RBAC seed', async () => {
    await request(ctx.server).get('/api/health').expect(200);
  });

  it.each([
    '/api/roles',
    '/api/users',
    '/api/auth/me',
    '/api/auth/oauth/start',
    '/api/auth/oauth/callback',
  ])('%s 在正式 runtime 不存在', async (path) => {
    await request(ctx.server).get(path).expect(404);
  });

  it('Spec 2 WebView 與 session routes 已註冊', async () => {
    await request(ctx.server).post('/api/auth/webview-launches').expect(401);
    await request(ctx.server).get('/api/auth/webview').expect(400);
    await request(ctx.server).post('/api/auth/session').expect(400);
    await request(ctx.server).get('/api/auth/session').expect(401);
    await request(ctx.server)
      .delete('/api/auth/session')
      .set('Origin', 'http://localhost:3000')
      .expect(200);
  });

  it('embed-origins 為 Public、no-store，回傳信任的主平台 origin 清單', async () => {
    const response = await request(ctx.server)
      .get('/api/auth/embed-origins')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    const body = response.body as { data: { origins: unknown } };
    expect(Array.isArray(body.data.origins)).toBe(true);
    expect(body.data.origins).toContain('http://localhost:3000');
  });
});
