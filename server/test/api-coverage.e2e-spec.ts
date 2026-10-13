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
});
