// security-headers.e2e-spec.ts
import request from 'supertest';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from '#app/app.module';
import {
  configureApp,
  registerFastifyPlugins,
} from '#app/bootstrap/app.bootstrap';

describe('SEC-05 HTTP 安全標頭 (US4)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { bodyParser: false },
    );
    configureApp(app);
    await registerFastifyPlugins(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('C-05a：健康檢查回應含 nosniff + X-Frame-Options: DENY', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('C-05a：404 回應同樣帶安全標頭', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/missing')
      .expect(404);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  describe('框架錯誤統一為穩定錯誤碼與繁中訊息，不回傳原始英文訊息或路徑', () => {
    // body 解析錯誤發生在路由比對之後，需要打已存在的 POST 路由
    const BODY_ROUTE = '/api/external-signature-session';
    const json = { 'content-type': 'application/json' };

    // 以 inject 送出，避免 413 提早回應時真實 socket 被重設
    it.each([
      [
        '路由不存在',
        { method: 'GET', url: '/api/missing/secret-path' },
        404,
        { code: 'NOT_FOUND', message: '找不到請求的資源' },
      ],
      [
        'JSON 格式錯誤',
        { method: 'POST', url: BODY_ROUTE, headers: json, payload: '{bad' },
        400,
        { code: 'INVALID_REQUEST', message: '請求格式錯誤' },
      ],
      [
        '不支援的 Content-Type',
        {
          method: 'POST',
          url: BODY_ROUTE,
          headers: { 'content-type': 'text/xml' },
          payload: '<a/>',
        },
        415,
        { code: 'INVALID_REQUEST', message: '請求格式錯誤' },
      ],
      [
        '內容超過大小限制',
        {
          method: 'POST',
          url: BODY_ROUTE,
          headers: json,
          payload: JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024) }),
        },
        413,
        { code: 'INVALID_REQUEST', message: '請求內容超過大小限制' },
      ],
    ] as const)('%s', async (_label, options, status, error) => {
      const res = await app
        .getHttpAdapter()
        .getInstance()
        .inject({ ...options });
      expect(res.statusCode).toBe(status);
      expect(res.json()).toEqual({
        success: false,
        error,
        timestamp: expect.any(String) as unknown,
      });
      expect(res.body).not.toContain('secret-path');
    });
  });
});
