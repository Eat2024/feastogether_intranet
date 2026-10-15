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

  it.each([
    ['GET', '/api/esign/signer-candidates'],
    ['GET', '/api/esign/documents'],
    ['POST', '/api/esign/documents'],
    ['GET', '/api/esign/documents/1'],
    ['PATCH', '/api/esign/documents/1'],
    ['DELETE', '/api/esign/documents/1'],
    ['PUT', '/api/esign/documents/1/draftSave'],
    ['PUT', '/api/esign/documents/1/fields'],
    ['POST', '/api/esign/documents/1/initiations'],
    ['POST', '/api/esign/documents/1/stoppages'],
    ['GET', '/api/esign/documents/1/source-file'],
    ['GET', '/api/esign/documents/1/history'],
    ['GET', '/api/esign/documents/1/completed-file'],
    ['GET', '/api/esign/signing-tasks'],
    ['POST', '/api/esign/signing-tasks/550e8400-e29b-41d4-a716-446655440000'],
    [
      'GET',
      '/api/esign/signing-tasks/550e8400-e29b-41d4-a716-446655440000/source-file',
    ],
    [
      'POST',
      '/api/esign/signing-tasks/550e8400-e29b-41d4-a716-446655440000/signatures',
    ],
  ] as const)(
    '%s %s 已註冊且受 employee session 保護',
    async (method, path) => {
      const response = await request(ctx.server)
        [method.toLowerCase() as 'get'](path)
        .set('Origin', 'http://localhost:3000');
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        success: false,
        error: { code: 'UNAUTHORIZED' },
      });
    },
  );

  it('6 個 external invitation/task operations 已註冊且維持公開憑證邊界', async () => {
    const token = 'A'.repeat(43);
    await request(ctx.server)
      .get(`/api/external-signature-invitations/${token}`)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    await request(ctx.server)
      .post('/api/external-signature-session')
      .set('Origin', 'http://localhost:3000')
      .type('form')
      .send({ token })
      .expect(401);
    await request(ctx.server)
      .delete('/api/external-signature-session')
      .set('Origin', 'http://localhost:3000')
      .expect(204);
    await request(ctx.server)
      .post('/api/external-signing-task')
      .set('Origin', 'http://localhost:3000')
      .expect(401);
    await request(ctx.server)
      .get('/api/external-signing-task/source-file')
      .expect(401);
    await request(ctx.server)
      .post('/api/external-signing-task/signatures')
      .set('Origin', 'http://localhost:3000')
      .send({})
      .expect(400);
  });

  it('3 個 external completion operations 已註冊且只接受 receipt', async () => {
    const signerPublicId = '550e8400-e29b-41d4-a716-446655440000';
    await request(ctx.server)
      .get(`/api/external-completions/${signerPublicId}`)
      .expect(401);
    await request(ctx.server)
      .get(`/api/external-completions/${signerPublicId}/completed-file`)
      .expect(401);
    await request(ctx.server)
      .get(`/api/external-completions/${signerPublicId}/history`)
      .expect(401);
  });
});
