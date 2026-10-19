import { AppException } from '#app/common/errors/app.exception';
import { AppErrors } from '#app/common/errors/app-errors';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Redis } from 'ioredis';
import { REDIS_MAIN } from '#app/infrastructure/database/redis/redis.provider';
import { RedisService } from '#app/infrastructure/database/redis/redis.service';
import { EsignSignerCandidateService } from '#app/features/esign/services/esign-signer-candidate.service';
import { createHash, randomUUID } from 'node:crypto';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { FeastogetherDepartmentService } from '#app/infrastructure/http-client/feastogether/services/feastogether-department.service';
import { FeastogetherConfig } from '#app/infrastructure/http-client/feastogether/feastogether.config';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { assertTestRedisDb } from '#app/infrastructure/database/test/ensure-test-redis';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  SecurityE2eContext,
} from './security-e2e.helper';

const route = '/api/esign/signer-candidates/org-chart';
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const headers = { cookie: `${AUTH_COOKIE_NAME}=synthetic-session` };

describe('組織樹 API', () => {
  let ctx: SecurityE2eContext;
  const contexts: SecurityE2eContext[] = [];
  let client: Redis;
  const upstream = { getOrgChart: jest.fn().mockResolvedValue([]) };
  const source = `https://synthetic.invalid/${randomUUID()}`;
  const hash = createHash('sha256')
    .update(JSON.stringify([process.env.NODE_ENV ?? 'development', source]))
    .digest('hex');
  const key = `esign:org-chart:v1:${hash}`;
  beforeAll(async () => {
    assertTestRedisDb();
    for (let i = 0; i < 2; i++) {
      contexts.push(
        await createSecurityE2eApp((builder) =>
          builder
            .overrideProvider(FeastogetherDepartmentService)
            .useValue(upstream)
            .overrideProvider(FeastogetherConfig)
            .useValue({ baseUrl: source })
            .overrideProvider(AuthService)
            .useValue({
              verifySessionToken: (token: string) =>
                Promise.resolve(
                  token === 'synthetic-session' ? { userId: 1 } : null,
                ),
            }),
        ),
      );
    }
    ctx = contexts[0];
    client = ctx.app.get<Redis>(REDIS_MAIN);
  });
  beforeEach(async () => {
    await client.del(key);
    upstream.getOrgChart.mockReset().mockImplementation(async () => {
      await pause(100);
      return [];
    });
  });
  afterAll(async () => {
    if (client?.status === 'ready') await client.del(key);
    await Promise.all(contexts.map((context) => closeSecurityE2eApp(context)));
  });

  it('有效員工 session 取得 envelope／no-store，沒有業務資料異動', async () => {
    const manager = ctx.app.get(MysqlService).getManager();
    const tables = [
      'users',
      'esign_documents',
      'esign_signers',
      'esign_signature_records',
      'esign_audit_events',
    ];
    const counts = () =>
      Promise.all(
        tables.map((table) =>
          manager.query(`SELECT COUNT(*) AS count FROM ${table}`),
        ),
      );
    const before = await counts();
    const response = await ctx.app.inject({
      method: 'GET',
      url: route,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<unknown>()).toEqual({
      success: true,
      data: [],
      timestamp: expect.any(String) as unknown,
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(await counts()).toEqual(before);
  });

  it('缺少或失效 session 回 401，不呼叫上游', async () => {
    upstream.getOrgChart.mockClear();
    for (const value of ['', `${AUTH_COOKIE_NAME}=invalid`]) {
      const response = await ctx.app.inject({
        method: 'GET',
        url: route,
        headers: { cookie: value },
      });
      expect(response.statusCode).toBe(401);
    }
    expect(upstream.getOrgChart).not.toHaveBeenCalled();
  });
  it('兩個 HTTP 實例共用快取，1,000 次讀取不續期', async () => {
    for (const context of contexts) {
      const response = await context.app.inject({
        method: 'GET',
        url: route,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<{ data: unknown }>().data).toEqual([]);
    }
    expect(upstream.getOrgChart).toHaveBeenCalledTimes(1);
    const before = await client.pttl(key);
    expect(before).toBeGreaterThan(7_190_000);
    expect(before).toBeLessThanOrEqual(7_200_000);
    for (let i = 0; i < 1_000; i++)
      await contexts[i % 2].app.get(EsignSignerCandidateService).getOrgChart();
    expect(await client.pttl(key)).toBeLessThan(before);
    expect(upstream.getOrgChart).toHaveBeenCalledTimes(1);
  });

  it('有效／無快取時，無效 session 均不讀組織快取', async () => {
    const read = jest.spyOn(ctx.app.get(RedisService), 'get');
    try {
      for (const cached of [false, true]) {
        if (cached)
          await client.set(
            key,
            JSON.stringify({ version: 1, data: [] }),
            'EX',
            7200,
          );
        for (const cookie of ['', `${AUTH_COOKIE_NAME}=invalid`]) {
          expect(
            (
              await ctx.app.inject({
                method: 'GET',
                url: route,
                headers: { cookie },
              })
            ).statusCode,
          ).toBe(401);
        }
      }
      expect(read).not.toHaveBeenCalled();
      expect(upstream.getOrgChart).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it('快取到期不自動更新，只由下一次請求更新', async () => {
    const service = ctx.app.get(EsignSignerCandidateService);
    await service.getOrgChart();
    await client.pexpire(key, 30);
    await pause(60);
    expect(await client.get(key)).toBeNull();
    expect(upstream.getOrgChart).toHaveBeenCalledTimes(1);
    await service.getOrgChart();
    expect(upstream.getOrgChart).toHaveBeenCalledTimes(2);
  });

  it('Swagger 描述完整 envelope 與遞迴部門 DTO', () => {
    const document = SwaggerModule.createDocument(
      ctx.app,
      new DocumentBuilder().build(),
    );
    const responses = document.paths[route].get?.responses;
    expect(responses?.['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              data: {
                type: 'array',
                items: { $ref: '#/components/schemas/OrgDepartmentDto' },
              },
            },
          },
        },
      },
    });
    for (const status of ['401', '502', '503'])
      expect(responses?.[status]).toMatchObject({
        content: {
          'application/json': {
            schema: { required: ['success', 'error', 'timestamp'] },
          },
        },
      });
  });

  it('同時未命中各自呼叫上游，失敗不快取，後續新請求可恢復', async () => {
    upstream.getOrgChart.mockImplementation(async () => {
      await pause(200);
      throw new AppException(...AppErrors.ORG_CHART_UPSTREAM_UNAVAILABLE);
    });
    const responses = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        contexts[i % 2].app.inject({ method: 'GET', url: route, headers }),
      ),
    );
    expect(
      responses.filter((response) => response.statusCode === 502),
    ).toHaveLength(50);
    expect(
      responses.filter((response) => response.statusCode === 503),
    ).toHaveLength(0);
    for (const response of responses)
      expect(response.json<unknown>()).toMatchObject({
        success: false,
        error: {
          code:
            response.statusCode === 502
              ? 'ORG_CHART_UPSTREAM_UNAVAILABLE'
              : 'ORG_CHART_UNAVAILABLE',
        },
      });
    expect(upstream.getOrgChart).toHaveBeenCalledTimes(50);
    expect(await client.get(key)).toBeNull();
    upstream.getOrgChart.mockResolvedValue([]);
    expect(
      (await ctx.app.inject({ method: 'GET', url: route, headers })).statusCode,
    ).toBe(200);
  }, 20_000);

  it('Redis 錯誤回 503，不回傳原始錯誤或直連上游', async () => {
    const read = jest
      .spyOn(ctx.app.get(RedisService), 'get')
      .mockRejectedValueOnce(new Error('synthetic-private-data'));
    try {
      const response = await ctx.app.inject({
        method: 'GET',
        url: route,
        headers,
      });
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain('synthetic-private-data');
      expect(upstream.getOrgChart).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });
});
