import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { ExceptionHandler } from './exception.handler';

const makeHost = (): {
  host: ArgumentsHost;
  sent: { status?: number; body?: unknown };
} => {
  const sent: { status?: number; body?: unknown } = {};
  // 具名後 `this` 才有型別（物件字面值中的 `this` 是 any）
  const reply = {
    status(code: number): typeof reply {
      sent.status = code;
      return reply;
    },
    send(body: unknown): typeof reply {
      sent.body = body;
      return reply;
    },
  };
  const request = { method: 'GET', url: '/api/x', headers: {} };
  const host = {
    switchToHttp: () => ({
      getRequest: (): typeof request => request,
      getResponse: (): typeof reply => reply,
    }),
  } as unknown as ArgumentsHost;
  return { host, sent };
};

describe('ExceptionHandler', () => {
  let logger: { error: jest.Mock };
  let handler: ExceptionHandler;

  beforeEach(() => {
    logger = { error: jest.fn() };
    handler = new ExceptionHandler(logger as unknown as AppLoggerService);
  });

  it('非 HttpException → 回 500 並以 error 記 stack', () => {
    const { host, sent } = makeHost();
    const err = new Error('boom');

    handler.catch(err, host);

    expect(sent.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [entry] = logger.error.mock.calls[0] as [
      {
        event: string;
        metadata: { stack?: string; statusCode: number; path: string };
      },
    ];
    expect(entry.event).toBe('http.unhandled_exception');
    expect(entry.metadata.stack).toBe(err.stack);
    expect(entry.metadata.statusCode).toBe(500);
    expect(entry.metadata.path).toBe('/api/x');
    expect(sent.body).toMatchObject({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal Server Error',
      },
    });
    expect(sent.body).toHaveProperty('timestamp');
    expect(sent.body).not.toHaveProperty('path');
  });

  it('HttpException → 用其狀態碼，且不記 error（屬預期錯誤）', () => {
    const { host, sent } = makeHost();

    handler.catch(new HttpException('forbidden', HttpStatus.FORBIDDEN), host);

    expect(sent.status).toBe(HttpStatus.FORBIDDEN);
    expect(logger.error).not.toHaveBeenCalled();
    expect(sent.body).toMatchObject({
      success: false,
      error: { code: 'HTTP_ERROR', message: 'forbidden' },
    });
    expect(sent.body).toHaveProperty('timestamp');
    expect(sent.body).not.toHaveProperty('path');
  });

  it('HttpException 有 details 時結構化轉送，未提供時不新增欄位', () => {
    const { host, sent } = makeHost();
    handler.catch(
      new HttpException(
        {
          error: 'NOT_FOUND',
          message: '資料已更新',
          details: { currentRevision: 4 },
        },
        HttpStatus.CONFLICT,
      ),
      host,
    );
    expect(sent.body).toMatchObject({
      error: {
        code: 'NOT_FOUND',
        message: '資料已更新',
        details: { currentRevision: 4 },
      },
    });
  });
});
