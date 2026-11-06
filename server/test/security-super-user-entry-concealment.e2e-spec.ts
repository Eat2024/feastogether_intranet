import { randomBytes } from 'node:crypto';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request, { type Response } from 'supertest';
import { DataSource } from 'typeorm';
import { AUTH_RATE_LIMIT_SHORT_LIMIT } from '#app/features/auth/auth.constants';
import { ENTRY_NETWORK_DENIED_HEADER } from '#app/features/auth/guards/super-user-entry.guard';
import { SuperUserConfigService } from '#app/features/auth/services/super-user-config.service';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

const ORIGIN = 'http://localhost:3000';
const newEntry = () => randomBytes(32).toString('base64url');
// 限流計數存 Redis 且跨回合存活；每個情境用不同 client IP。
const newIp = () =>
  `198.19.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
/** 每次都不同的值：比對時排除。 */
const VOLATILE_HEADERS = ['date', 'x-request-id', 'connection', 'keep-alive'];

type Probe = (path: string) => request.Test;

/**
 * 不知道入口的人不能從 HTTP 回應看出維護登入存在（使用者 2026-11-06 要求）：
 * 錯誤入口、尚未初始化，以及 client proxy 標記來源網路不允許的請求，GET／POST 都與不存在的路由回應相同，
 * 不因 Origin、限流或 body 而不同。
 */
describe('Super user 錯誤入口與不存在路由的回應相同', () => {
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let entryKey: string;

  const snapshot = (response: Response) => ({
    status: response.status,
    headers: Object.fromEntries(
      Object.entries(response.headers).filter(
        ([name]) => !VOLATILE_HEADERS.includes(name),
      ),
    ),
    body: { ...(response.body as object), timestamp: undefined },
  });
  /** 回傳兩者相同的快照，讓呼叫端再確認狀態碼。 */
  const compare = async (probe: Probe) => {
    const wrong = await probe(`/api/auth/super-user-entries/${newEntry()}`);
    const missing = await probe(`/api/no-such-route/${newEntry()}`);
    expect(snapshot(wrong)).toEqual(snapshot(missing));
    return snapshot(wrong);
  };
  const post = (path: string, ip = newIp()) =>
    request(ctx.server).post(path).set('X-Forwarded-For', ip);
  const credentials = { account: 'someone', password: 'something' };

  beforeAll(async () => {
    ctx = await createSecurityE2eApp(undefined, null);
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
    entryKey = newEntry();
    await db.query(
      `INSERT INTO super_user_access (id, entry_key, entry_generation, rotated_at, period_start_at,
        active_credential_fingerprint, credential_generation, credential_activated_at)
        VALUES (1, ?, 1, NOW(6), NOW(6), ?, 1, NOW(6))`,
      [entryKey, ctx.app.get(SuperUserConfigService).fingerprint],
    );
  });

  afterAll(async () => {
    if (ctx) {
      await db.query('DELETE FROM super_user_access');
      await closeSecurityE2eApp(ctx);
    }
  });

  it.each<[string, Probe]>([
    ['GET 入口', (path) => request(ctx.server).get(path)],
    ['GET sessions', (path) => request(ctx.server).get(`${path}/sessions`)],
    ['POST 入口本身', (path) => post(path).set('Origin', ORIGIN)],
    [
      'POST sessions（受信任 Origin）',
      (path) =>
        post(`${path}/sessions`).set('Origin', ORIGIN).send(credentials),
    ],
    [
      'POST sessions（缺 Origin）',
      (path) => post(`${path}/sessions`).send(credentials),
    ],
    [
      'POST sessions（不受信任 Origin、跨站）',
      (path) =>
        post(`${path}/sessions`)
          .set('Origin', 'https://evil.example')
          .set('Sec-Fetch-Site', 'cross-site')
          .send(credentials),
    ],
    [
      'POST sessions（多餘欄位）',
      (path) =>
        post(`${path}/sessions`).set('Origin', ORIGIN).send({ remember: true }),
    ],
    [
      'POST sessions（9 KiB body）',
      (path) =>
        post(`${path}/sessions`)
          .set('Origin', ORIGIN)
          .send({ account: 'a', password: 'x'.repeat(9 * 1024) }),
    ],
    [
      'POST sessions（text/plain）',
      (path) =>
        post(`${path}/sessions`)
          .set('Origin', ORIGIN)
          .set('Content-Type', 'text/plain')
          .send('hello'),
    ],
    ['PUT sessions', (path) => request(ctx.server).put(`${path}/sessions`)],
  ])('%s：回與不存在路由相同的 404', async (_label, probe) => {
    const { status, body } = await compare(probe);

    expect(status).toBe(404);
    expect(body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: '找不到請求的資源' },
      timestamp: undefined,
    });
  });

  it('JSON 格式錯誤：Fastify 對兩者都先解析 body，同為 400', async () => {
    const { status } = await compare((path) =>
      post(`${path}/sessions`)
        .set('Origin', ORIGIN)
        .set('Content-Type', 'application/json')
        .send('{bad'),
    );

    expect(status).toBe(400);
  });

  it('同一 IP 在有效入口已被限流（429）時，錯誤入口仍與不存在路由相同', async () => {
    const ip = newIp();
    for (let i = 0; i < AUTH_RATE_LIMIT_SHORT_LIMIT; i++) {
      await post(`/api/auth/super-user-entries/${entryKey}/sessions`, ip)
        .set('Origin', ORIGIN)
        .send({})
        .expect(400);
    }
    await post(`/api/auth/super-user-entries/${entryKey}/sessions`, ip)
      .set('Origin', ORIGIN)
      .send(credentials)
      .expect(429);

    const { status } = await compare((path) =>
      post(`${path}/sessions`, ip).set('Origin', ORIGIN).send(credentials),
    );
    expect(status).toBe(404);
  });

  it('client proxy 標記來源網路不允許時，有效入口的 GET 與 POST 也與不存在路由相同', async () => {
    const valid = `/api/auth/super-user-entries/${entryKey}`;
    const missing = `/api/no-such-route/${newEntry()}`;
    const denied = (test: request.Test) =>
      test.set(ENTRY_NETWORK_DENIED_HEADER, '1');

    expect(
      snapshot(await denied(request(ctx.server).get(valid)).expect(404)),
    ).toEqual(snapshot(await request(ctx.server).get(missing)));
    const login = (path: string) =>
      post(`${path}/sessions`).set('Origin', ORIGIN).send(credentials);
    expect(snapshot(await denied(login(valid)).expect(404))).toEqual(
      snapshot(await login(missing)),
    );
    await request(ctx.server).get(valid).expect(200);
  });

  it('尚未初始化（沒有任何有效入口）時，GET 與 POST 也與不存在路由相同', async () => {
    await db.query(
      'UPDATE super_user_access SET deleted_at = NOW(6) WHERE id = 1',
    );
    try {
      for (const probe of [
        (path: string) => request(ctx.server).get(path),
        (path: string) =>
          post(`${path}/sessions`).set('Origin', ORIGIN).send(credentials),
      ]) {
        expect((await compare(probe)).status).toBe(404);
      }
    } finally {
      await db.query(
        'UPDATE super_user_access SET deleted_at = NULL WHERE id = 1',
      );
    }
  });

  it('Swagger 不列出隱藏入口路由', () => {
    const document = SwaggerModule.createDocument(
      ctx.app,
      new DocumentBuilder().build(),
    );

    expect(Object.keys(document.paths).length).toBeGreaterThan(0);
    expect(JSON.stringify(document)).not.toMatch(/super-user|Super user|維護/);
  });
});
