import request from 'supertest';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

describe('正式 runtime 不暴露 dev login', () => {
  let ctx: SecurityE2eContext;

  beforeAll(async () => {
    ctx = await createSecurityE2eApp();
  });

  afterAll(async () => closeSecurityE2eApp(ctx));

  it.each([
    ['GET', '/api/auth/login-options'],
    ['POST', '/api/auth/dev-login'],
    ['POST', '/api/auth/logout'],
    ['GET', '/api/auth/me'],
  ])('%s %s 回 404', async (method, path) => {
    const call =
      method === 'GET'
        ? request(ctx.server).get(path)
        : request(ctx.server).post(path);
    await call.expect(404);
  });
});
