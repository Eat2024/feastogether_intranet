import { createHash } from 'node:crypto';
import { ExternalOtpService } from './external-otp.service';

/** 以 Map 模擬 Redis；TTL 只記錄設定值（到期由真 Redis 負責，e2e 另驗）。 */
function setup() {
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
    increment: (key: string, ttl: number) => {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(next));
      if (next === 1) ttls.set(key, ttl);
      return Promise.resolve(next);
    },
  };
  const service = new ExternalOtpService(redis as never);
  /** 寄出新驗證碼並回傳寄信內容中的驗證碼 */
  const issue = async (signerId = 7) => {
    let sent = '';
    await service.issue(signerId, (code) => {
      sent = code;
      return Promise.resolve();
    });
    return sent;
  };
  return { service, store, ttls, issue };
}

describe('ExternalOtpService', () => {
  it('寄出 6 位數字驗證碼，只保存「簽署人 id + 驗證碼」的雜湊，10 分鐘有效', async () => {
    const { store, ttls, issue } = setup();

    const code = await issue(7);

    expect(code).toMatch(/^\d{6}$/);
    const values = [...store.values()];
    expect(values).toContain(
      createHash('sha256').update(`7:${code}`).digest('hex'),
    );
    expect(values.join()).not.toContain(code);
    expect([...ttls.values()]).toEqual([600]);
    expect([...store.keys()].every((key) => key.includes(':7:'))).toBe(true);
  });

  it('寄送失敗時不保存新驗證碼', async () => {
    const { service, store } = setup();

    await expect(
      service.issue(7, () => Promise.reject(new Error('smtp down'))),
    ).rejects.toThrow('smtp down');

    expect(store.size).toBe(0);
  });

  it('正確驗證碼只能使用一次', async () => {
    const { service, issue } = setup();
    const code = await issue();

    await expect(service.verify(7, code)).resolves.toEqual({
      status: 'verified',
    });
    await expect(service.verify(7, code)).resolves.toEqual({
      status: 'expired',
    });
  });

  it('尚未寄出或已過期（Redis 已無驗證碼）時回報已失效', async () => {
    const { service } = setup();

    await expect(service.verify(7, '123456')).resolves.toEqual({
      status: 'expired',
    });
  });

  it('重新寄出後舊驗證碼立即失效', async () => {
    const { service, issue } = setup();
    const first = await issue();
    let second = await issue();
    while (second === first) second = await issue();

    await expect(service.verify(7, first)).resolves.toMatchObject({
      status: 'wrong',
    });
    await expect(service.verify(7, second)).resolves.toEqual({
      status: 'verified',
    });
  });

  it('錯誤時回報剩餘次數，錯滿 5 次即失效，之後正確驗證碼也無法使用', async () => {
    const { service, issue } = setup();
    const code = await issue();
    const wrong = code === '000000' ? '000001' : '000000';

    for (const remainingAttempts of [4, 3, 2, 1]) {
      await expect(service.verify(7, wrong)).resolves.toEqual({
        status: 'wrong',
        remainingAttempts,
      });
    }
    await expect(service.verify(7, wrong)).resolves.toEqual({
      status: 'locked',
    });
    await expect(service.verify(7, code)).resolves.toEqual({
      status: 'expired',
    });
  });

  it('錯 4 次後第 5 次輸入正確仍可通過', async () => {
    const { service, issue } = setup();
    const code = await issue();
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 4; i += 1) await service.verify(7, wrong);

    await expect(service.verify(7, code)).resolves.toEqual({
      status: 'verified',
    });
  });

  it('重新寄出後錯誤次數重新計算', async () => {
    const { service, issue } = setup();
    const first = await issue();
    const wrong = first === '000000' ? '000001' : '000000';
    for (let i = 0; i < 4; i += 1) await service.verify(7, wrong);

    let code = await issue();
    while (code === wrong) code = await issue();

    await expect(service.verify(7, wrong)).resolves.toEqual({
      status: 'wrong',
      remainingAttempts: 4,
    });
  });

  it('驗證碼綁定簽署人：其他簽署人無法使用', async () => {
    const { service, issue } = setup();
    const code = await issue(7);

    await expect(service.verify(8, code)).resolves.toEqual({
      status: 'expired',
    });
    await expect(service.verify(7, code)).resolves.toEqual({
      status: 'verified',
    });
  });

  it('只接受 6 位半形數字', () => {
    const { service } = setup();
    expect(service.isCodeFormat('012345')).toBe(true);
    expect(service.isCodeFormat('12345')).toBe(false);
    expect(service.isCodeFormat('1234567')).toBe(false);
    expect(service.isCodeFormat('12345a')).toBe(false);
    expect(service.isCodeFormat('１２３４５６')).toBe(false);
    expect(service.isCodeFormat(undefined as unknown as string)).toBe(false);
  });
});
