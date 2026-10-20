import request from 'supertest';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';
import { apiError } from './api-response.helper';

describe('核心電子簽安全邊界', () => {
  let ctx: SecurityE2eContext;
  const token = 'A'.repeat(43);

  beforeAll(async () => {
    ctx = await createSecurityE2eApp();
  });

  afterAll(async () => closeSecurityE2eApp(ctx));

  it('invitation GET 只回 no-store/no-referrer bridge，不建立 cookie 或查詢業務結果', async () => {
    const response = await request(ctx.server)
      .get(`/api/external-signature-invitations/${token}`)
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.text).not.toMatch(/document|email|candidate/i);
  });

  it.each([
    ['缺少 Origin', undefined],
    ['不受信任 Origin', 'https://evil.example'],
  ])('%s 時在 token/DB 驗證前固定 403', async (_label, origin) => {
    let call = request(ctx.server)
      .post('/api/external-signature-session')
      .type('form')
      .send({ token });
    if (origin) call = call.set('Origin', origin);
    const response = await call.expect(403);
    expect(apiError(response).message).not.toContain(token);
  });

  it('受信任 Origin 才進 credential 驗證，失效憑證只回通用 401 HTML 錯誤頁', async () => {
    const response = await request(ctx.server)
      .post('/api/external-signature-session')
      .set('Origin', 'http://localhost:3000')
      .type('form')
      .send({ token })
      .expect(401)
      .expect('Content-Type', /^text\/html/)
      .expect('Cache-Control', 'no-store')
      .expect('Referrer-Policy', 'no-referrer');
    expect(response.text).toContain('邀請連結無效或已到期');
    expect(response.text).not.toContain(token);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('邀請 token 格式錯誤時 GET 與 POST 都回 400 HTML 錯誤頁', async () => {
    const malformed = 'not-a-token';
    const responses = [
      await request(ctx.server)
        .get(`/api/external-signature-invitations/${malformed}`)
        .expect(400),
      await request(ctx.server)
        .post('/api/external-signature-session')
        .set('Origin', 'http://localhost:3000')
        .type('form')
        .send({ token: malformed })
        .expect(400),
    ];
    for (const response of responses) {
      expect(response.headers['content-type']).toMatch(/^text\/html/);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.text).toContain('邀請連結格式錯誤');
      expect(response.text).not.toContain(malformed);
      expect(response.headers['set-cookie']).toBeUndefined();
    }
  });

  it('所有 external cookie write path 都要求 Origin，且錯誤不反射 cookie', async () => {
    const cookie = `FT_ESIGN_EXTERNAL_ACCESS=${token}`;
    const missingOrigin = await request(ctx.server)
      .post('/api/external-signing-task')
      .set('Cookie', cookie)
      .expect(403);
    expect(JSON.stringify(missingOrigin.body)).not.toContain(token);

    const invalid = await request(ctx.server)
      .post('/api/external-signing-task')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', cookie)
      .expect(401);
    expect(JSON.stringify(invalid.body)).not.toContain(token);
  });

  it.each([
    '/api/external-signing-task',
    '/api/external-signing-task/completed-file',
  ])(
    'GET %s 為唯讀、不需 Origin，失效 cookie 只回通用 401 且不反射 cookie',
    async (path) => {
      const response = await request(ctx.server)
        .get(path)
        .set('Cookie', `FT_ESIGN_EXTERNAL_ACCESS=${token}`)
        .expect(401);
      expect(apiError(response).code).toBe('ESIGN_EXTERNAL_UNAUTHORIZED');
      expect(JSON.stringify(response.body)).not.toContain(token);
      expect(String(response.headers['set-cookie'] ?? '')).not.toContain(token);
    },
  );

  it('舊 receipt 無法存取個人副本，退役路徑不再提供下載', async () => {
    const signerId = '00000000-0000-4000-8000-000000000001';
    for (const path of [
      `/api/esign/documents/1/signers/${signerId}/completed-file`,
      `/api/esign/signing-tasks/${signerId}/completed-file`,
    ]) {
      const response = await request(ctx.server)
        .get(path)
        .set('Cookie', `FT_ESIGN_EXTERNAL_RECEIPT=${token}`)
        .expect(401);
      expect(JSON.stringify(response.body)).not.toContain(token);
    }
    await request(ctx.server)
      .get('/api/external-completions/completed-file')
      .set('Cookie', `FT_ESIGN_EXTERNAL_RECEIPT=${token}`)
      .expect(404);
  });
});
