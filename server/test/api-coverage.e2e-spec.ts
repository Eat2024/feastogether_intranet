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
});
