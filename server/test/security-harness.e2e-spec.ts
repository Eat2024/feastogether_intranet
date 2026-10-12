import request from 'supertest';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

describe('security harness — default user-session boundary', () => {
  let ctx: SecurityE2eContext;

  beforeAll(async () => {
    ctx = await createSecurityE2eApp();
  });

  afterAll(async () => closeSecurityE2eApp(ctx));

  it('公開 health 不依賴 role、permission 或 session', async () => {
    await request(ctx.server).get('/api/health').expect(200);
  });

  it.each(['/api/roles', '/api/users'])(
    '已刪除的管理入口 %s 維持 404',
    async (path) => {
      await request(ctx.server).get(path).expect(404);
    },
  );
});
