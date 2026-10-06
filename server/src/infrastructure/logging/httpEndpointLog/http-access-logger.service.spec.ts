import { HttpAccessLoggerService } from './http-access-logger.service';
import type { HttpAccessLogEntry } from './http-access-logger.service';
import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';

type LogPayload = Record<string, unknown>;

interface PinoLoggerMock {
  info: jest.Mock<void, [LogPayload]>;
  warn: jest.Mock<void, [LogPayload]>;
  error: jest.Mock<void, [LogPayload]>;
}

interface ConfigServiceMock {
  get: jest.Mock<string | undefined, [string]>;
}

const baseEntry = (
  over: Partial<HttpAccessLogEntry> = {},
): HttpAccessLogEntry => ({
  type: 'http_access',
  method: 'GET',
  path: '/api/x',
  url: '/api/x',
  statusCode: 200,
  requestAt: '2026-06-22T00:00:00.000Z',
  responseAt: '2026-06-22T00:00:00.100Z',
  durationMs: 100,
  ...over,
});

const make = (threshold: number) => {
  const pino: PinoLoggerMock = {
    info: jest.fn<void, [LogPayload]>(),
    warn: jest.fn<void, [LogPayload]>(),
    error: jest.fn<void, [LogPayload]>(),
  };
  const config: ConfigServiceMock = {
    get: jest.fn((k: string) =>
      k === 'LOG_SLOW_MS' ? String(threshold) : undefined,
    ),
  };
  return {
    svc: new HttpAccessLoggerService(
      pino as unknown as PinoLogger,
      config as unknown as ConfigService,
    ),
    pino,
  };
};

describe('HttpAccessLoggerService', () => {
  it('durationMs >= 門檻 → 加 isSlow + slowThresholdMs', () => {
    const { svc, pino } = make(50);
    svc.write(baseEntry({ durationMs: 100 }));
    expect(pino.info).toHaveBeenCalledWith(
      expect.objectContaining({ isSlow: true, slowThresholdMs: 50 }),
    );
  });

  it('durationMs < 門檻 → 不帶 isSlow', () => {
    const { svc, pino } = make(1000);
    svc.write(baseEntry({ durationMs: 100 }));
    const payload = pino.info.mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty('isSlow');
  });

  it('依 status 選 level：>=500 error、>=400 warn、其餘 info', () => {
    const { svc, pino } = make(1000);
    svc.write(baseEntry({ statusCode: 200 }));
    svc.write(baseEntry({ statusCode: 404 }));
    svc.write(baseEntry({ statusCode: 500 }));
    expect(pino.info).toHaveBeenCalledTimes(1);
    expect(pino.warn).toHaveBeenCalledTimes(1);
    expect(pino.error).toHaveBeenCalledTimes(1);
  });
});
