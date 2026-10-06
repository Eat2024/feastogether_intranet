import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '#app/app.module';
import {
  configureApp,
  createFastifyAdapter,
  registerFastifyPlugins,
} from '#app/bootstrap/app.bootstrap';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AUTH_RATE_LIMIT_SHORT_LIMIT } from '#app/features/auth/auth.constants';
import type { ApiError } from './api-response.helper';

/**
 * 032 認證端點速率限制 e2e（登入入口為統一登入的 start／callback）。
 *
 * 直接用 auth.constants 的正式設定跑（短視窗 10 次/60 秒），不另外縮短視窗——
 * 數值只有一處來源，測試就該驗那一處，spec SC-001 因此由本檔直接涵蓋。
 *
 * app MUST 以 createFastifyAdapter() 建立而非 `new FastifyAdapter()`——限流以
 * `req.ip` 為單位，沒有 trustProxy 就測不到正式環境的 IP 解析行為。
 */

// 計數存 Redis 且跨測試回合存活（短視窗 60 秒）；用隨機末碼避免重跑撞到既有額度。
const suffix = () => Math.floor(Math.random() * 250) + 1;
const IP_A = `203.0.113.${suffix()}`;
const IP_B = `198.51.100.${suffix()}`;

describe('auth rate limit e2e (032)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      createFastifyAdapter(),
    );
    configureApp(app);
    await registerFastifyPlugins(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  /**
   * 以合成參數打統一登入回呼（無交易 cookie → 400，不會打上游）；
   * `x-forwarded-for` 模擬不同來源 client。
   */
  const login = (ip: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/oauth/callback',
      headers: { 'x-forwarded-for': ip },
      payload: { state: 'synthetic-state', code: 'synthetic-code' },
    });

  const envelopeOf = (body: string): ApiError => JSON.parse(body) as ApiError;

  /** 打滿短視窗額度（第 limit+1 次即為第一個被擋下的請求）。 */
  const exhaust = async (ip: string) => {
    for (let i = 0; i < AUTH_RATE_LIMIT_SHORT_LIMIT; i += 1) await login(ip);
  };

  it('未達閾值的請求正常處理（不是 429）', async () => {
    const res = await login(IP_A);

    expect(res.statusCode).not.toBe(429);
  });

  it('第 11 次請求（超過 10 次/60 秒）回 429，符合統一錯誤契約並帶 Retry-After', async () => {
    await exhaust(IP_A);

    const res = await login(IP_A);

    expect(res.statusCode).toBe(429);
    const envelope = envelopeOf(res.body);
    expect(envelope.success).toBe(false);
    expect(envelope.error.code).toBe(AppErrorCode.REFUSE_SERVICE);
    expect(typeof envelope.timestamp).toBe('string');
    expect(res.headers['retry-after']).toBeDefined();
  });

  // 回歸守衛：父類別預設的 tracker 取 req.ips[0]（= socket 位址，正式環境為
  // Next.js 容器 IP），會讓兩個 IP 共用同一個桶而一起被鎖。此案必須失敗。
  it('IP A 被限流時，IP B 不受影響', async () => {
    await exhaust(IP_A);
    expect((await login(IP_A)).statusCode).toBe(429);

    const res = await login(IP_B);

    expect(res.statusCode).not.toBe(429);
  });

  it('callback 被限流時，start 仍有自己的額度（端點各自計數）', async () => {
    await exhaust(IP_A);
    expect((await login(IP_A)).statusCode).toBe(429);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/oauth/start',
      headers: { 'x-forwarded-for': IP_A },
      payload: {},
    });

    expect(res.statusCode).not.toBe(429);
  });
});
