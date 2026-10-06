// security-harness.e2e-spec.ts
// 034 T008：先證 harness 本身可信——
// 未登入被擋、有效 session 放行、RBAC allow/deny 正確。harness 不可信則後續所有
// security-* 斷言都無意義。
import request from 'supertest';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  seedSecurityRbac,
  issueSession,
  resetSecurityFixtures,
  type SecurityE2eContext,
  type SecurityIdentities,
} from './security-e2e.helper';

describe('security harness — enforced auth + RBAC sanity (T008)', () => {
  let ctx: SecurityE2eContext;
  let ids: SecurityIdentities;
  let adminCookie: string;
  let noPermCookie: string;

  beforeAll(async () => {
    ctx = await createSecurityE2eApp();
    ids = await seedSecurityRbac(ctx);
    adminCookie = await issueSession(ctx, ids.adminUserId);
    noPermCookie = await issueSession(ctx, ids.noPermUserId);
  });

  afterAll(async () => {
    await resetSecurityFixtures(ctx);
    await closeSecurityE2eApp(ctx);
  });

  it('未登入呼叫受保護端點 → 401（認證確實強制）', async () => {
    await request(ctx.server).get('/api/auth/me').expect(401);
  });

  it('有效 session（admin）→ 200（JWT + Redis session 生效）', async () => {
    await request(ctx.server)
      .get('/api/auth/me')
      .set('Cookie', adminCookie)
      .expect(200);
  });

  it('登入但無權限（noPerm）呼叫需權限端點 → 403（RBAC deny）', async () => {
    await request(ctx.server)
      .get('/api/roles')
      .set('Cookie', noPermCookie)
      .expect(403);
  });

  it('admin 呼叫需權限端點 → 200（RBAC allow）', async () => {
    await request(ctx.server)
      .get('/api/roles')
      .set('Cookie', adminCookie)
      .expect(200);
  });
});
