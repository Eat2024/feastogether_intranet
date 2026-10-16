import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AUTH_RATE_LIMIT_SHORT_LIMIT } from '#app/features/auth/auth.constants';
import { EsignTokenService } from '#app/features/esign/services/esign-token.service';
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

/** 依 token 格式以任意私鑰簽發，模擬非本系統簽發的 token。 */
function tokenSignedByOtherKey(signerPublicId: string): string {
  const payload = Buffer.concat([
    Buffer.from([0x01, 1]),
    Buffer.from(signerPublicId.replaceAll('-', ''), 'hex'),
  ]);
  const { privateKey } = generateKeyPairSync('ed25519');
  return Buffer.concat([payload, sign(null, payload, privateKey)]).toString(
    'base64url',
  );
}

function tamper(token: string): string {
  const index = 40;
  return `${token.slice(0, index)}${token[index] === 'A' ? 'B' : 'A'}${token.slice(index + 1)}`;
}

describe('公開簽章驗證安全邊界', () => {
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let tokens: EsignTokenService;

  beforeAll(async () => {
    ctx = await createSecurityE2eApp();
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
    tokens = ctx.app.get(EsignTokenService);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => closeSecurityE2eApp(ctx));

  it('偽造、竄改、錯誤長度、結構錯誤、他鑰簽發與查無簽署人的 token 回應完全相同，且不寫入、不設 cookie、不記錄 token', async () => {
    // 簽章正確但簽署人不存在，代表「通過驗章後查 DB 才失敗」的路徑
    const unknownSigner = tokens.verificationToken(randomUUID());
    const candidates = [
      'A'.repeat(110),
      tamper(unknownSigner),
      unknownSigner.slice(0, -1),
      `${unknownSigner}A`,
      tokenSignedByOtherKey(randomUUID()),
      unknownSigner,
      // 結構錯誤的路徑也走同一個 handler，不落到 router 的通用 404
      'A'.repeat(300),
      `${unknownSigner}/extra`,
      `${unknownSigner}/`,
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
    const token = tokens.verificationToken(randomUUID());
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
