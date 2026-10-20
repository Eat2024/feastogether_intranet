import request from 'supertest';
import { AUTH_RATE_LIMIT_SHORT_LIMIT } from '#app/features/auth/auth.constants';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';
import { apiError } from './api-response.helper';
import { otpMails, requestOtp, submitOtp } from './external-session.helper';
import { randomClientIp } from './signature-verification.helper';

describe('核心電子簽安全邊界', () => {
  let ctx: SecurityE2eContext;
  const token = 'A'.repeat(43);
  /** script 只放行單一固定內容（重新寄送倒數）的雜湊，不允許 inline 或外部 script。 */
  const INVITATION_PAGE_CSP =
    /^default-src 'none'; script-src 'sha256-[A-Za-z0-9+/]{43}='; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'$/;

  /** 邀請頁在取得存取前由後端直接回應：HTML、不快取、不送 referrer、不可嵌入、不設 cookie。 */
  function expectInvitationPageHeaders(response: request.Response) {
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['content-security-policy']).toMatch(
      INVITATION_PAGE_CSP,
    );
    expect(response.headers['set-cookie']).toBeUndefined();
  }

  beforeAll(async () => {
    ctx = await createSecurityE2eApp();
  });

  afterAll(async () => closeSecurityE2eApp(ctx));

  it('invitation GET 只回邀請確認頁，不建立 cookie 或查詢業務結果', async () => {
    const response = await request(ctx.server)
      .get(`/api/external-signature-invitations/${token}`)
      .expect(200);
    expectInvitationPageHeaders(response);
    expect(response.text).toContain('電子簽署邀請</h1>');
    expect(response.text).toContain(
      '<form method="post" action="/api/external-signature-otps">',
    );
    expect(response.text).toContain('開啟電子簽署文件</button>');
    expect(response.text).not.toContain('nonce');
    expect(response.text).not.toMatch(/document|email|candidate/i);
  });

  const forms = [
    ['/api/external-signature-otps', { token }],
    ['/api/external-signature-session', { token, code: '000000' }],
  ] as const;

  it.each(
    forms.flatMap(([path, form]) => [
      ['缺少 Origin', path, form, undefined],
      ['不受信任 Origin', path, form, 'https://evil.example'],
    ]),
  )(
    '%s 時 %s 在 token/DB 驗證前固定 403',
    async (_label, path, form, origin) => {
      let call = request(ctx.server)
        .post(path)
        .set('X-Forwarded-For', randomClientIp())
        .type('form')
        .send(form);
      if (origin) call = call.set('Origin', origin);
      const response = await call.expect(403);
      expect(apiError(response).message).not.toContain(token);
    },
  );

  it('受信任 Origin 才進 credential 驗證，失效憑證只回通用 401 失效頁，不寄驗證碼', async () => {
    const mailCount = otpMails(ctx).length;
    const responses = [
      await requestOtp(ctx, token).expect(401),
      await submitOtp(ctx, token, '000000').expect(401),
    ];
    for (const response of responses) {
      expectInvitationPageHeaders(response);
      expect(response.text).toContain('邀請連結無效或已到期</h1>');
      expect(response.text).toContain('請聯絡文件發起人重新寄送邀請');
      expect(response.text).toContain('可能原因：');
      expect(response.text).not.toContain(token);
    }
    expect(responses[1].text).toBe(responses[0].text);
    expect(otpMails(ctx)).toHaveLength(mailCount);
  });

  it('邀請 token 或驗證碼格式錯誤時回 400，內容與失效憑證相同', async () => {
    const malformed = 'not-a-token';
    const invalid = await requestOtp(ctx, token).expect(401);
    const responses = [
      await request(ctx.server)
        .get(`/api/external-signature-invitations/${malformed}`)
        .expect(400),
      await requestOtp(ctx, malformed).expect(400),
      await submitOtp(ctx, malformed, '000000').expect(400),
      ...(await Promise.all(
        ['', '12345', '1234567', '12345a'].map((code) =>
          submitOtp(ctx, token, code).expect(400),
        ),
      )),
    ];
    for (const response of responses) {
      expectInvitationPageHeaders(response);
      expect(response.text).toBe(invalid.text);
      expect(response.text).not.toContain(malformed);
    }
  });

  it.each(forms)(
    '%s 依 client IP 限流：超過短視窗額度回 429，其他 IP 不受影響，限流 log 不含 token',
    async (path, form) => {
      const clientIp = randomClientIp();
      const appWarn = jest.spyOn(ctx.app.get(AppLoggerService), 'warn');
      const post = (ip: string) =>
        request(ctx.server)
          .post(path)
          .set('Origin', 'http://localhost:3000')
          .set('X-Forwarded-For', ip)
          .type('form')
          .send(form);
      try {
        for (let index = 0; index < AUTH_RATE_LIMIT_SHORT_LIMIT; index += 1) {
          await post(clientIp).expect(401);
        }
        const limited = await post(clientIp).expect(429);
        expect(limited.headers['retry-after']).toBeDefined();
        expect(
          JSON.stringify([limited.body, appWarn.mock.calls]).includes(token),
        ).toBe(false);
        await post(randomClientIp()).expect(401);
      } finally {
        appWarn.mockRestore();
      }
    },
  );

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
