import { ConfigService } from '@nestjs/config';
import type { Options } from 'pino-http';
import { buildPinoHttpOptions } from './logger.config';

const config = (env: Record<string, string | undefined>) =>
  ({
    get: jest.fn((key: string) => env[key]),
  }) as unknown as ConfigService;

/**
 * 宣告回傳型別為 pino-http `Options`：函式簽章寫的是 `Params['pinoHttp']`，
 * 那是含 DestinationStream 的聯集，取 .timestamp/.transport 會編不過。
 */
const buildOptions = (env: Record<string, string | undefined>): Options =>
  buildPinoHttpOptions(config(env)) as Options;

describe('buildPinoHttpOptions', () => {
  it('production 使用 UTC ISO timestamp', () => {
    const options = buildOptions({ NODE_ENV: 'production' });

    expect(options.timestamp).toBeDefined();
    const fragment =
      typeof options.timestamp === 'function' ? options.timestamp() : '';
    expect(fragment).toMatch(/"time":"\d{4}-\d{2}-\d{2}T/);
    expect(fragment).toContain('Z');
  });

  it('development pretty time 使用 UTC 而非本機時區', () => {
    const options = buildOptions({ NODE_ENV: 'development' });

    expect(options.transport).toMatchObject({
      target: 'pino-pretty',
      options: { translateTime: 'UTC:standard' },
    });
  });

  it('staging 不用 pino-pretty（production image 無 devDependency）', () => {
    expect(buildOptions({ NODE_ENV: 'staging' }).transport).toBeUndefined();
    expect(buildOptions({ NODE_ENV: 'production' }).transport).toBeUndefined();
  });
});
