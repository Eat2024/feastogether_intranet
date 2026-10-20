import { createHash } from 'node:crypto';
import { ExternalOtpService } from './external-otp.service';

/** 以 Map 模擬 Redis，到期時間依（fake timers 控制的）系統時間判斷。 */
function fakeRedis() {
  const store = new Map<string, { value: string; expiresAt?: number }>();
  const live = (key: string) => {
    const entry = store.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    return entry;
  };
  const expiresAt = (ttl?: number) =>
    ttl === undefined ? undefined : Date.now() + ttl * 1000;
  return {
    store,
    get: (key: string) => Promise.resolve(live(key)?.value ?? null),
    set: (key: string, value: string, ttl?: number) => {
      store.set(key, { value, expiresAt: expiresAt(ttl) });
      return Promise.resolve();
    },
    setIfAbsent: (key: string, value: string, ttl: number) => {
      if (live(key)) return Promise.resolve(false);
      store.set(key, { value, expiresAt: expiresAt(ttl) });
      return Promise.resolve(true);
    },
    del: (...keys: string[]) =>
      Promise.resolve(
        keys.filter((key) => live(key) && store.delete(key)).length,
      ),
    increment: (key: string, ttl: number) => {
      const entry = live(key);
      const next = Number(entry?.value ?? 0) + 1;
      store.set(key, {
        value: String(next),
        expiresAt: entry ? entry.expiresAt : expiresAt(ttl),
      });
      return Promise.resolve(next);
    },
    ttl: (key: string) => {
      const entry = live(key);
      if (!entry) return Promise.resolve(-2);
      if (entry.expiresAt === undefined) return Promise.resolve(-1);
      return Promise.resolve(Math.ceil((entry.expiresAt - Date.now()) / 1000));
    },
  };
}

function setup() {
  const redis = fakeRedis();
  const service = new ExternalOtpService(redis as never);
  /** 寄出新驗證碼並回傳寄信內容中的驗證碼 */
  const issue = async (signerId = 7) => {
    let sent = '';
    await expect(
      service.issue(signerId, (code) => {
        sent = code;
        return Promise.resolve();
      }),
    ).resolves.toEqual({ status: 'sent', retryAfterSeconds: 60 });
    return sent;
  };
  return { service, store: redis.store, issue };
}

/** 推進系統時間（Redis 到期以系統時間判斷） */
function elapse(seconds: number) {
  jest.setSystemTime(Date.now() + seconds * 1000);
}

describe('ExternalOtpService', () => {
  beforeEach(() =>
    jest.useFakeTimers({ now: new Date('2026-10-20T02:00:00Z') }),
  );
  afterEach(() => jest.useRealTimers());

  it('寄出 6 位數字驗證碼，只保存「簽署人 id + 驗證碼」的雜湊，10 分鐘後失效', async () => {
    const { service, store, issue } = setup();

    const code = await issue(7);

    expect(code).toMatch(/^\d{6}$/);
    const values = [...store.values()].map((entry) => entry.value);
    expect(values).toContain(
      createHash('sha256').update(`7:${code}`).digest('hex'),
    );
    expect(values.join()).not.toContain(code);
    expect([...store.keys()].every((key) => key.includes(':7:'))).toBe(true);
    elapse(10 * 60);
    await expect(service.verify(7, code)).resolves.toEqual({
      status: 'expired',
    });
  });

  it('距上次寄送未滿 60 秒不寄送、不覆寫現有驗證碼，回報剩餘秒數；滿 60 秒後可再寄送', async () => {
    const { service, issue } = setup();
    const code = await issue();
    elapse(45);
    const deliver = jest.fn(() => Promise.resolve());

    await expect(service.issue(7, deliver)).resolves.toEqual({
      status: 'cooldown',
      retryAfterSeconds: 15,
    });
    expect(deliver).not.toHaveBeenCalled();
    await expect(service.verify(7, code)).resolves.toEqual({
      status: 'verified',
    });

    elapse(15);
    await issue();
  });

  it('同一簽署人自第一次寄送起 1 小時內最多寄 5 封，之後回報上限與剩餘秒數，滿 1 小時才可再寄送', async () => {
    const { service, issue } = setup();
    for (let i = 0; i < 5; i += 1) {
      await issue();
      elapse(60);
    }
    const deliver = jest.fn(() => Promise.resolve());

    await expect(service.issue(7, deliver)).resolves.toEqual({
      status: 'hourly-limit',
      retryAfterSeconds: 3300,
    });
    expect(deliver).not.toHaveBeenCalled();
    // 其他簽署人不受影響
    await issue(8);

    elapse(3299);
    await expect(service.issue(7, deliver)).resolves.toMatchObject({
      status: 'hourly-limit',
    });
    elapse(1);
    await issue();
  });

  it('寄送失敗不計入冷卻與每小時次數', async () => {
    const { service, issue } = setup();
    for (let i = 0; i < 4; i += 1) {
      await issue();
      elapse(60);
    }

    await expect(
      service.issue(7, () => Promise.reject(new Error('smtp down'))),
    ).resolves.toEqual({ status: 'delivery-failed' });

    // 失敗後可立即重寄，且仍算第 5 封
    await issue();
    elapse(60);
    await expect(
      service.issue(7, () => Promise.resolve()),
    ).resolves.toMatchObject({ status: 'hourly-limit' });
  });

  it('同一簽署人同時要求寄送時只寄出一封', async () => {
    const { service } = setup();
    const deliver = jest.fn(() => Promise.resolve());

    const results = await Promise.all([
      service.issue(7, deliver),
      service.issue(7, deliver),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      'cooldown',
      'sent',
    ]);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('寄送失敗時不保存新驗證碼', async () => {
    const { service, store } = setup();

    await expect(
      service.issue(7, () => Promise.reject(new Error('smtp down'))),
    ).resolves.toEqual({ status: 'delivery-failed' });

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
    let second = first;
    while (second === first) {
      elapse(60);
      second = await issue();
    }

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

    let code = wrong;
    while (code === wrong) {
      elapse(60);
      code = await issue();
    }

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
