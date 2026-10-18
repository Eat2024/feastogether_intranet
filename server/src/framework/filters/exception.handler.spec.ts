import {
  ArgumentsHost,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
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
    expect(entry.metadata.stack).not.toContain('boom');
    expect(entry.metadata.statusCode).toBe(500);
    expect(entry.metadata.path).toBe('/api/x');
    expect(sent.body).toMatchObject({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: '系統發生未預期錯誤',
      },
    });
    expect(sent.body).toHaveProperty('timestamp');
    expect(sent.body).not.toHaveProperty('path');
  });

  it('AppException → 用其狀態碼、錯誤碼與訊息，且不記 error（屬預期錯誤）', () => {
    const { host, sent } = makeHost();

    handler.catch(
      new AppException(
        AppErrorCode.ESIGN_STATE_CONFLICT,
        '文件已發起，無法修改草稿',
        HttpStatus.CONFLICT,
      ),
      host,
    );

    expect(sent.status).toBe(HttpStatus.CONFLICT);
    expect(logger.error).not.toHaveBeenCalled();
    expect(sent.body).toEqual({
      success: false,
      error: {
        code: 'ESIGN_STATE_CONFLICT',
        message: '文件已發起，無法修改草稿',
      },
      timestamp: expect.any(String) as unknown,
    });
  });

  it('AppException 有 details 時結構化轉送', () => {
    const { host, sent } = makeHost();
    handler.catch(
      new AppException(
        AppErrorCode.ESIGN_STATE_CONFLICT,
        '資料已更新',
        HttpStatus.CONFLICT,
        { currentRevision: 4 },
      ),
      host,
    );
    expect(sent.body).toMatchObject({
      error: {
        code: 'ESIGN_STATE_CONFLICT',
        message: '資料已更新',
        details: { currentRevision: 4 },
      },
    });
  });

  it.each([
    [
      new NotFoundException('Cannot GET /api/x/secret'),
      404,
      'NOT_FOUND',
      '找不到請求的資源',
    ],
    [
      new HttpException('forbidden', HttpStatus.FORBIDDEN),
      403,
      'FORBIDDEN',
      '沒有權限執行此操作',
    ],
    [
      new HttpException('Body too large', HttpStatus.PAYLOAD_TOO_LARGE),
      413,
      'INVALID_REQUEST',
      '請求內容超過大小限制',
    ],
    [
      new HttpException(
        'Unsupported Media Type',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      ),
      415,
      'INVALID_REQUEST',
      '請求格式錯誤',
    ],
    [
      new HttpException('Bad Gateway', HttpStatus.BAD_GATEWAY),
      502,
      'INTERNAL_ERROR',
      '系統發生未預期錯誤',
    ],
  ])(
    '框架錯誤 %#：依 status 回固定的錯誤碼與繁中訊息，不回傳原始訊息',
    (exception, status, code, message) => {
      const { host, sent } = makeHost();

      handler.catch(exception, host);

      expect(sent.status).toBe(status);
      expect(logger.error).not.toHaveBeenCalled();
      expect(sent.body).toMatchObject({
        success: false,
        error: { code, message },
      });
      expect(JSON.stringify(sent.body)).not.toContain(exception.message);
    },
  );
});
