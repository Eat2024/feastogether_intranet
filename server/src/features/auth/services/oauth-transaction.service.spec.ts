import { AppErrorCode } from '#app/common/errors/app-error-code';
import { OAUTH_TX_TTL_SECONDS } from '#app/features/auth/auth.constants';
import { OauthTransactionService } from './oauth-transaction.service';

/** 以 Map 模擬 Redis 的 set／getdel（原子性由真 Redis 的 GETDEL 保證，e2e 另驗）。 */
const setup = () => {
  const store = new Map<string, string>();
  const redis = {
    set: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    getDel: jest.fn((key: string) => {
      const value = store.get(key) ?? null;
      store.delete(key);
      return Promise.resolve(value);
    }),
  };
  return { service: new OauthTransactionService(redis as never), redis, store };
};

const challenge = { state: 'st-1', nonce: 'nc-1' };

describe('OauthTransactionService', () => {
  it('start：以 10 分鐘 TTL 存 nonce／redirectTo，key 含瀏覽器綁定摘要與 state，不存原始 token', async () => {
    const { service, redis, store } = setup();

    const browserToken = await service.start(challenge, '/orders');

    expect(browserToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [key, value, ttl] = redis.set.mock.calls[0] as [
      string,
      string,
      number,
    ];
    expect(key).toMatch(/^oauth:tx:[0-9a-f]{64}:st-1$/);
    expect(key).not.toContain(browserToken);
    expect(JSON.parse(value)).toEqual({
      nonce: 'nc-1',
      redirectTo: '/orders',
    });
    expect(ttl).toBe(OAUTH_TX_TTL_SECONDS);
    expect(store.size).toBe(1);
  });

  it('claim：正確瀏覽器＋state 領到交易，且只能領一次（重放 400）', async () => {
    const { service } = setup();
    const browserToken = await service.start(challenge, '/orders');

    await expect(service.claim('st-1', browserToken)).resolves.toEqual({
      challenge,
      redirectTo: '/orders',
    });
    await expect(service.claim('st-1', browserToken)).rejects.toMatchObject({
      code: AppErrorCode.OAUTH_TRANSACTION_INVALID,
    });
  });

  it('claim：瀏覽器綁定不符 → 400，且不消耗原交易（正確瀏覽器仍可領）', async () => {
    const { service } = setup();
    const browserToken = await service.start(challenge, '/');

    await expect(service.claim('st-1', 'other-browser')).rejects.toMatchObject({
      code: AppErrorCode.OAUTH_TRANSACTION_INVALID,
    });
    await expect(service.claim('st-1', browserToken)).resolves.toBeDefined();
  });

  it('claim：缺 cookie 或 state 不存在 → 400', async () => {
    const { service } = setup();
    const browserToken = await service.start(challenge, '/');

    await expect(service.claim('st-1', null)).rejects.toMatchObject({
      code: AppErrorCode.OAUTH_TRANSACTION_INVALID,
    });
    await expect(service.claim('unknown', browserToken)).rejects.toMatchObject({
      code: AppErrorCode.OAUTH_TRANSACTION_INVALID,
    });
  });

  it('Redis 故障 → 503 OAUTH_UNAVAILABLE（fail closed）', async () => {
    const { service, redis } = setup();
    redis.set.mockRejectedValueOnce(new Error('synthetic redis down'));
    redis.getDel.mockRejectedValueOnce(new Error('synthetic redis down'));

    await expect(service.start(challenge, '/')).rejects.toMatchObject({
      code: AppErrorCode.OAUTH_UNAVAILABLE,
    });
    await expect(service.claim('st-1', 'b')).rejects.toMatchObject({
      code: AppErrorCode.OAUTH_UNAVAILABLE,
    });
  });
});
