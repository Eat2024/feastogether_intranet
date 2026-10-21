import { createHash } from 'node:crypto';
import { ExternalAccessCredentialService } from './external-access-credential.service';

describe('ExternalAccessCredentialService', () => {
  function setup() {
    // Redis 以 Map 模擬，TTL 只記錄設定值、不會到期（到期由真 Redis 負責，e2e 另驗）
    const store = new Map<string, string>();
    const ttls = new Map<string, number>();
    const redis = {
      get: (key: string) => Promise.resolve(store.get(key) ?? null),
      set: (key: string, value: string, ttl?: number) => {
        store.set(key, value);
        if (ttl !== undefined) ttls.set(key, ttl);
        return Promise.resolve();
      },
      del: (...keys: string[]) =>
        Promise.resolve(keys.filter((key) => store.delete(key)).length),
    };
    return {
      service: new ExternalAccessCredentialService(redis as never),
      store,
      ttls,
    };
  }

  it('建立 32-byte base64url 隨機憑證，Redis 只以雜湊為 key 存簽署人 id，8 小時後失效', async () => {
    const { service, store, ttls } = setup();

    const credential = await service.issue(7, 'a'.repeat(64));

    expect(credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const key = `esign:external-access:${createHash('sha256').update(credential).digest('hex')}`;
    expect([...store]).toEqual([
      [
        key,
        JSON.stringify({
          signerId: 7,
          invitationGenerationSha256: 'a'.repeat(64),
        }),
      ],
    ]);
    expect(ttls.get(key)).toBe(8 * 60 * 60);
    expect(JSON.stringify([...store])).not.toContain(credential);
  });

  it('每次驗證成功產生不同憑證', async () => {
    const { service } = setup();
    expect(await service.issue(7, 'a'.repeat(64))).not.toBe(
      await service.issue(7, 'a'.repeat(64)),
    );
  });

  it('以憑證取回簽署人 id；不存在、已過期或已結束時回 null', async () => {
    const { service, store } = setup();
    const credential = await service.issue(7, 'a'.repeat(64));

    await expect(service.read(credential)).resolves.toEqual({
      signerId: 7,
      invitationGenerationSha256: 'a'.repeat(64),
    });
    await expect(service.read('A'.repeat(43))).resolves.toBeNull();

    await service.revoke(credential);
    expect(store.size).toBe(0);
    await expect(service.read(credential)).resolves.toBeNull();
  });
  it('未綁定邀請世代的舊憑證不得恢復補簽資格', async () => {
    const { service, store } = setup();
    const credential = await service.issue(7, 'a'.repeat(64));
    const key = [...store.keys()][0];
    store.set(key, '7');
    await expect(service.read(credential)).resolves.toBeNull();
  });
});
