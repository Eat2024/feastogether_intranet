import { AppLoggerService, buildAppLogEntry } from './app-logger.service';
import type { PinoLogger } from 'nestjs-pino';

type LogPayload = Record<string, unknown>;

interface PinoLoggerMock {
  info: jest.Mock<void, [LogPayload]>;
  warn: jest.Mock<void, [LogPayload]>;
  error: jest.Mock<void, [LogPayload]>;
}

describe('buildAppLogEntry', () => {
  it('產生 {type:app, event, message?, context?, metadata?}，不含 requestId/userId（由 mixin 補）', () => {
    const entry = buildAppLogEntry({
      event: 'auth.jwt_verify_failed',
      message: 'JWT verify failed',
      context: 'AuthGuard',
      metadata: { reason: 'expired' },
    });
    expect(entry).toEqual({
      type: 'app',
      event: 'auth.jwt_verify_failed',
      message: 'JWT verify failed',
      context: 'AuthGuard',
      metadata: { reason: 'expired' },
    });
    expect(entry).not.toHaveProperty('requestId');
    expect(entry).not.toHaveProperty('userId');
  });

  it('只給 event 時，省略 undefined 欄位', () => {
    expect(buildAppLogEntry({ event: 'redis.recovered' })).toEqual({
      type: 'app',
      event: 'redis.recovered',
    });
  });
});

describe('AppLoggerService', () => {
  it('info/warn/error 以對應 pino 方法輸出 entry', () => {
    const pino: PinoLoggerMock = {
      info: jest.fn<void, [LogPayload]>(),
      warn: jest.fn<void, [LogPayload]>(),
      error: jest.fn<void, [LogPayload]>(),
    };
    const svc = new AppLoggerService(pino as unknown as PinoLogger);

    svc.info({ event: 'e.info' });
    svc.warn({ event: 'e.warn' });
    svc.error({ event: 'e.error', message: 'boom' });

    expect(pino.info).toHaveBeenCalledWith({ type: 'app', event: 'e.info' });
    expect(pino.warn).toHaveBeenCalledWith({ type: 'app', event: 'e.warn' });
    expect(pino.error).toHaveBeenCalledWith({
      type: 'app',
      event: 'e.error',
      message: 'boom',
    });
  });
});
