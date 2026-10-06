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
