import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import { HttpAccessLogInterceptor } from './http-access-log.interceptor';
import type {
  HttpAccessLogEntry,
  HttpAccessLoggerService,
} from '#app/infrastructure/logging/httpEndpointLog/http-access-logger.service';

interface AccessLoggerMock {
  write: jest.Mock<void, [HttpAccessLogEntry]>;
}

interface MaskedRequestBody {
  password: string;
  keep: number;
}

const makeContext = (
  req: Record<string, unknown>,
  statusCode = 200,
): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ statusCode }),
    }),
  }) as unknown as ExecutionContext;

const baseReq = (over: Record<string, unknown> = {}) => ({
  method: 'POST',
  url: '/api/orders?x=1',
  headers: { 'user-agent': 'jest' },
  query: { x: '1' },
  body: { password: 'secret', keep: 1 },
  ...over,
});

describe('HttpAccessLogInterceptor', () => {
  const makeInterceptor = () => {
    const accessLogger: AccessLoggerMock = {
      write: jest.fn<void, [HttpAccessLogEntry]>(),
    };
    return {
      interceptor: new HttpAccessLogInterceptor(
        accessLogger as unknown as HttpAccessLoggerService,
      ),
      accessLogger,
    };
  };

  const getWrittenEntry = (accessLogger: AccessLoggerMock) => {
    const entry = accessLogger.write.mock.calls[0]?.[0];
    if (!entry) throw new Error('expected access log entry');
    return entry;
  };

  it('成功請求：組 type=http_access、時間欄位、遮罩 request body', async () => {
    const { interceptor, accessLogger } = makeInterceptor();
    const ctx = makeContext(baseReq(), 200);
    const next: CallHandler = { handle: () => of({ ok: true }) };

    await lastValueFrom(interceptor.intercept(ctx, next));

    const entry = getWrittenEntry(accessLogger);
    const requestBody = entry.requestBody as MaskedRequestBody;
    expect(entry).toMatchObject({
      type: 'http_access',
      method: 'POST',
      path: '/api/orders',
      statusCode: 200,
    });
    expect(typeof entry.requestAt).toBe('string');
    expect(typeof entry.responseAt).toBe('string');
    // ISO 8601 結尾的 Z 代表 UTC，避免 access log 輸出本地時區時間。
    expect(entry.requestAt).toMatch(/Z$/);
    expect(entry.responseAt).toMatch(/Z$/);
    expect(typeof entry.durationMs).toBe('number');
    expect(requestBody.password).toBe('***'); // 遮罩
    expect(requestBody.keep).toBe(1);
  });

  it('login 類路徑不記 request body', async () => {
    const { interceptor, accessLogger } = makeInterceptor();
    const ctx = makeContext(baseReq({ url: '/api/login' }), 200);
    await lastValueFrom(interceptor.intercept(ctx, { handle: () => of({}) }));
    expect(getWrittenEntry(accessLogger).requestBody).toBeUndefined();
  });
  it.each([
    '/api/esign/documents/9/initiations',
    '/esign/documents/9/initiations',
    '/api/esign/documents',
    '/api/esign/documents/9/draftSave',
    '/api/esign/signing-tasks/person/signatures',
  ])('電子簽文件、簽名與名單不寫入 access log：%s', async (url) => {
    const { interceptor, accessLogger } = makeInterceptor();
    await lastValueFrom(
      interceptor.intercept(
        makeContext(
          baseReq({
            url,
            body: { signers: [{ name: '測試', email: 'test@example.test' }] },
            query: { q: '測試同仁' },
          }),
          201,
        ),
        { handle: () => of({}) },
      ),
    );
    expect(getWrittenEntry(accessLogger).requestBody).toBeUndefined();
    expect(getWrittenEntry(accessLogger).query).toBeUndefined();
  });

  it('WebView GET 不記 URL query，session POST 不記 body', async () => {
    const first = makeInterceptor();
    await lastValueFrom(
      first.interceptor.intercept(
        makeContext(
          baseReq({
            method: 'GET',
            url: '/api/auth/webview?code=secret-code',
            query: { code: 'secret-code' },
          }),
        ),
        { handle: () => of({}) },
      ),
    );
    expect(getWrittenEntry(first.accessLogger)).toMatchObject({
      path: '/api/auth/webview',
      url: '/api/auth/webview',
      query: undefined,
    });

    const second = makeInterceptor();
    await lastValueFrom(
      second.interceptor.intercept(
        makeContext(
          baseReq({
            url: '/api/auth/session',
            body: { code: 'secret-code' },
          }),
        ),
        { handle: () => of({}) },
      ),
    );
    expect(getWrittenEntry(second.accessLogger).requestBody).toBeUndefined();
  });

  it('launch endpoint 即使收到惡意 JWT query 也只記固定 path', async () => {
    const { interceptor, accessLogger } = makeInterceptor();
    await lastValueFrom(
      interceptor.intercept(
        makeContext(
          baseReq({
            url: '/api/auth/webview-launches?token=raw-jwt',
            query: { token: 'raw-jwt' },
          }),
        ),
        { handle: () => of({}) },
      ),
    );
    expect(getWrittenEntry(accessLogger)).toMatchObject({
      path: '/api/auth/webview-launches',
      url: '/api/auth/webview-launches',
      query: undefined,
    });
  });

  it('公開簽章驗證只記正規化 path，不留完整 token', async () => {
    const { interceptor, accessLogger } = makeInterceptor();
    const token = 'A'.repeat(110);
    await lastValueFrom(
      interceptor.intercept(
        makeContext(
          baseReq({
            method: 'GET',
            url: `/api/signature-verifications/${token}?utm=qr`,
            query: { utm: 'qr' },
            body: undefined,
          }),
        ),
        { handle: () => of({}) },
      ),
    );
    const entry = getWrittenEntry(accessLogger);
    expect(entry).toMatchObject({
      path: '/api/signature-verifications/:token',
      url: '/api/signature-verifications/:token',
      query: undefined,
    });
    expect(JSON.stringify(entry)).not.toContain(token);
  });

  it('錯誤路徑：非 HttpException → fallback 500 並重新拋出', async () => {
    const { interceptor, accessLogger } = makeInterceptor();
    const ctx = makeContext(baseReq(), 200);
    const err = new Error('boom');
    const next: CallHandler = { handle: () => throwError(() => err) };

    await expect(lastValueFrom(interceptor.intercept(ctx, next))).rejects.toBe(
      err,
    );

    const entry = getWrittenEntry(accessLogger);
    expect(entry.statusCode).toBe(500);
  });
});
