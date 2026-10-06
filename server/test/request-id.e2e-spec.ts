import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { NestFactory } from '@nestjs/core';
import { isValidUuid } from '#app/infrastructure/logging/requestId/request-id';
import { buildTestAppModule } from './logging-app.factory';

/**
 * A1. request id e2e：驗證 ClsModule middleware（mount: true）的 idGenerator + setup
 *  - 無 x-request-id → 產生合法 UUID 並回寫 X-Request-Id
 *  - 帶合法 x-request-id → 沿用並 normalize 為小寫
 *  - 帶非法 x-request-id → 視為未提供，改產新 UUID
 */
describe('request id e2e - A1', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      buildTestAppModule(),
      new FastifyAdapter(),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const ping = (headers?: Record<string, string>) =>
    app.inject({ method: 'GET', url: '/ping', headers });

  it('無 x-request-id：產生合法 UUID 並回寫 X-Request-Id', async () => {
    const res = await ping();

    expect(res.statusCode).toBe(200);
    expect(isValidUuid(res.headers['x-request-id'])).toBe(true);
  });

  it('帶合法 x-request-id：沿用並 normalize 為小寫', async () => {
    const incoming = '3F2504E0-4F89-41D3-9A0C-0305E82C3301';

    const res = await ping({ 'x-request-id': incoming });

    expect(res.headers['x-request-id']).toBe(incoming.toLowerCase());
  });

  it('帶非法 x-request-id：視為未提供，改產新合法 UUID', async () => {
    const res = await ping({ 'x-request-id': 'not-a-uuid' });

    expect(res.headers['x-request-id']).not.toBe('not-a-uuid');
    expect(isValidUuid(res.headers['x-request-id'])).toBe(true);
  });
});
