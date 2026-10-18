import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AUTH_RATE_LIMIT_SHORT_LIMIT } from '#app/features/auth/auth.constants';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { HttpAccessLoggerService } from '#app/infrastructure/logging/httpEndpointLog/http-access-logger.service';
import { apiError } from './api-response.helper';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';
import {
  esignRowCounts,
  getSignatureVerification,
  randomClientIp,
} from './signature-verification.helper';

/** 格式正確但不存在於 DB 的驗證代碼 */
const unknownCode = () => randomBytes(16).toString('base64url');

describe('公開簽章驗證安全邊界', () => {
  let ctx: SecurityE2eContext;
  let db: DataSource;

  beforeAll(async () => {
    ctx = await createSecurityE2eApp();
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => closeSecurityE2eApp(ctx));

  it('偽造、錯誤長度、結構錯誤與查無的代碼回應完全相同，且不寫入、不設 cookie、不記錄代碼', async () => {
    // 格式正確但不存在，代表「查 DB 後才失敗」的路徑
    const unknown = unknownCode();
    const candidates = [
      unknown,
      'A'.repeat(22),
      unknown.slice(0, -1),
      `${unknown}A`,
      `${unknown.slice(0, -1)}=`,
      // 結構錯誤的路徑也走同一個 handler，不落到 router 的通用 404
      'A'.repeat(300),
      `${unknown}/extra`,
      `${unknown}/`,
      '',
    ];
    const accessLog = jest.spyOn(ctx.app.get(HttpAccessLoggerService), 'write');
    const appWarn = jest.spyOn(ctx.app.get(AppLoggerService), 'warn');
    const before = await esignRowCounts(db);

    for (const token of candidates) {
      const response = await getSignatureVerification(ctx.server, token)
        .expect(404)
        .expect('Cache-Control', 'no-store')
        .expect('Referrer-Policy', 'no-referrer');
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(apiError(response)).toEqual({
        code: 'ESIGN_RESOURCE_NOT_FOUND',
        message: '查無此簽章或驗證碼無效',
      });
    }

    expect(await esignRowCounts(db)).toEqual(before);
    expect(accessLog).toHaveBeenCalledTimes(candidates.length);
    const logged = JSON.stringify([accessLog.mock.calls, appWarn.mock.calls]);
    expect(logged).toContain('/api/signature-verifications/:token');
    for (const token of candidates.filter(Boolean)) {
      expect(logged).not.toContain(token);
    }
  });

  it('同一 client IP 超過登入端點的短視窗額度回 429，其他 IP 不受影響，限流 log 不含 token', async () => {
    const clientIp = randomClientIp();
    const token = unknownCode();
    const appWarn = jest.spyOn(ctx.app.get(AppLoggerService), 'warn');

    for (let index = 0; index < AUTH_RATE_LIMIT_SHORT_LIMIT; index += 1) {
      await getSignatureVerification(ctx.server, token, clientIp).expect(404);
    }
    const limited = await getSignatureVerification(
      ctx.server,
      token,
      clientIp,
    ).expect(429);
    expect(apiError(limited).code).toBe('REFUSE_SERVICE');
    expect(limited.headers['retry-after']).toBeDefined();
    expect(appWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.rate_limited',
        metadata: expect.objectContaining({
          path: '/api/signature-verifications/:token',
        }) as unknown,
      }),
    );
    expect(JSON.stringify(appWarn.mock.calls)).not.toContain(token);

    await getSignatureVerification(ctx.server, token).expect(404);
  });
});
