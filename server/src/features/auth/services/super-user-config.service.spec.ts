import crypto from 'node:crypto';
import { hashSuperUserPassword } from '../helpers/super-user-password';
import { SuperUserConfigService } from './super-user-config.service';

// 合成 fixture；不是任何環境的真實帳密。
const ACCOUNT = 'synthetic-ops';
const PASSWORD = 'synthetic-password';

const build = (env: Record<string, string | undefined>) =>
  new SuperUserConfigService({ get: (key: string) => env[key] } as never);

/** 執行並取回丟出的錯誤（未丟錯回 undefined）。 */
const thrownBy = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('SuperUserConfigService', () => {
  let hash: string;
  const validEnv = () => ({
    SUPER_USER_ACCOUNT: ACCOUNT,
    SUPER_USER_PASSWORD_HASH: hash,
  });

  beforeAll(async () => {
    hash = await hashSuperUserPassword(PASSWORD);
  });

  afterEach(() => jest.restoreAllMocks());

  it('完整設定 → 正確帳密通過，帳號或密碼錯誤皆不通過', async () => {
    const config = build(validEnv());

    await expect(config.verify(ACCOUNT, PASSWORD)).resolves.toBe(true);
    await expect(config.verify('other-ops', PASSWORD)).resolves.toBe(false);
    await expect(config.verify(ACCOUNT, 'wrong-password')).resolves.toBe(false);
  });

  it.each([
    ['缺 SUPER_USER_ACCOUNT', { SUPER_USER_ACCOUNT: undefined }],
    ['SUPER_USER_ACCOUNT 為空字串', { SUPER_USER_ACCOUNT: '' }],
    ['缺 SUPER_USER_PASSWORD_HASH', { SUPER_USER_PASSWORD_HASH: undefined }],
    ['SUPER_USER_PASSWORD_HASH 為空字串', { SUPER_USER_PASSWORD_HASH: '' }],
  ])('%s → 建構即失敗，沒有預設值', (_label, override) => {
    const key = Object.keys(override)[0];

    expect(thrownBy(() => build({ ...validEnv(), ...override }))).toEqual(
      new Error(`環境變數 ${key} 為必填`),
    );
  });

  it('hash 格式錯誤 → 建構即失敗，錯誤訊息只含變數名、不含設定值', () => {
    const invalid = hash.replace('scrypt:32768:', 'scrypt:16384:');
    const error = thrownBy(() =>
      build({ ...validEnv(), SUPER_USER_PASSWORD_HASH: invalid }),
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('SUPER_USER_PASSWORD_HASH');
    expect((error as Error).message).not.toContain(invalid.split(':')[5]);
  });

  it.each([
    ['前置空白', ` ${ACCOUNT}`],
    ['結尾空白', `${ACCOUNT} `],
    ['大小寫不同', 'Synthetic-ops'],
  ])('輸入帳號不 trim／不轉換：%s 不通過', async (_label, account) => {
    await expect(build(validEnv()).verify(account, PASSWORD)).resolves.toBe(
      false,
    );
  });

  it('設定的帳號也不 trim／不 normalize，必須逐字相符', async () => {
    const account = ` café-ops `;
    const config = build({ ...validEnv(), SUPER_USER_ACCOUNT: account });

    await expect(config.verify(account, PASSWORD)).resolves.toBe(true);
    await expect(config.verify(account.trim(), PASSWORD)).resolves.toBe(false);
    await expect(
      config.verify(account.normalize('NFD'), PASSWORD),
    ).resolves.toBe(false);
  });

  it.each([
    ['錯帳號', 'other-ops', PASSWORD],
    ['錯密碼', ACCOUNT, 'wrong-password'],
    ['正確帳密', ACCOUNT, PASSWORD],
  ])('%s 都執行一次相同參數的 scrypt', async (_label, account, password) => {
    const scrypt = jest.spyOn(crypto, 'scrypt');

    await build(validEnv()).verify(account, password);

    expect(scrypt).toHaveBeenCalledTimes(1);
    expect(scrypt).toHaveBeenCalledWith(
      password,
      expect.any(Buffer),
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      expect.any(Function),
    );
  });

  it('同一組設定 fingerprint 穩定；同密碼重新產生 hash（新 salt）視為新版本', async () => {
    const first = build(validEnv()).fingerprint;
    const rehashed = await hashSuperUserPassword(PASSWORD);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(build(validEnv()).fingerprint).toBe(first);
    expect(
      build({ ...validEnv(), SUPER_USER_PASSWORD_HASH: rehashed }).fingerprint,
    ).not.toBe(first);
  });
});
