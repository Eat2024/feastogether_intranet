import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';
import { getSignatureVerification } from './signature-verification.helper';

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

  it.each(internalOperations())(
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

  it('已移除的 external completion operations 不再提供存取', async () => {
    const signerPublicId = '550e8400-e29b-41d4-a716-446655440000';
    await request(ctx.server)
      .get(`/api/external-completions/${signerPublicId}`)
      .expect(404);
    await request(ctx.server)
      .get(`/api/external-completions/${signerPublicId}/completed-file`)
      .expect(404);
    await request(ctx.server)
      .get(`/api/external-completions/${signerPublicId}/history`)
      .expect(404);
  });

  it('公開簽章驗證已註冊、不需 session，無效 token 回統一 404 envelope', async () => {
    const response = await getSignatureVerification(ctx.server, 'A'.repeat(22))
      .expect(404)
      .expect('Cache-Control', 'no-store')
      .expect('Referrer-Policy', 'no-referrer');
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'ESIGN_RESOURCE_NOT_FOUND' },
    });
  });

  it('公開簽章驗證已註冊、不需 session，無效 token 回統一 404 envelope', async () => {
    const response = await getSignatureVerification(ctx.server, 'A'.repeat(22))
      .expect(404)
      .expect('Cache-Control', 'no-store')
      .expect('Referrer-Policy', 'no-referrer');
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'ESIGN_RESOURCE_NOT_FOUND' },
    });
  });
});

/** 從 contract 的 paths 區讀取 operations，避免新增路由卻漏掉 session gate 驗收。 */
function internalOperations(): Array<[string, string]> {
  const spec = readFileSync(
    resolve(
      __dirname,
      '../../specs/003-core-esign-flow/contracts/openapi.yaml',
    ),
    'utf8',
  );
  const operations: Array<[string, string]> = [];
  let path = '';
  for (const line of spec.split('\n')) {
    if (line === 'components:') break;
    const pathMatch = /^  (\/[^:]+):$/.exec(line);
    if (pathMatch) path = pathMatch[1];
    const method = /^    (get|post|put|patch|delete):$/.exec(line);
    if (method && path.startsWith('/esign/'))
      operations.push([
        method[1].toUpperCase(),
        '/api' +
          path
            .replace('{documentId}', '1')
            .replace(
              '{signerPublicId}',
              '550e8400-e29b-41d4-a716-446655440000',
            ),
      ]);
  }
  if (operations.length === 0)
    throw new Error('無法讀取電子簽 contract operations');
  return operations;
}
