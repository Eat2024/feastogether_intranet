import type { INestApplicationContext } from '@nestjs/common';
import {
  parseSuperUserPasswordHash,
  verifySuperUserPassword,
} from '#app/features/auth/helpers/super-user-password';
import { createAuthConsole } from './repl';

describe('REPL 密碼雜湊工具', () => {
  const app = { get: jest.fn() } as unknown as INestApplicationContext;
  const auth = createAuthConsole(app);

  it('產生登入可驗證的 hash，保留空白與 Unicode，且每次使用新 salt', async () => {
    const password = ' 測試密碼 é ';
    const encoded = await auth.hashPassword(password);
    const parsed = parseSuperUserPasswordHash(encoded);
    expect(parsed).toBeDefined();
    if (!parsed) throw new Error('測試 hash 格式錯誤');
    expect(await verifySuperUserPassword(password, parsed)).toBe(true);
    expect(await verifySuperUserPassword(password.trim(), parsed)).toBe(false);
    expect(await auth.hashPassword(password)).not.toBe(encoded);
  });

  it.each(['', '密'.repeat(342), undefined, 123])(
    '拒絕無效密碼且錯誤不帶輸入值（案例 %#）',
    async (password) => {
      await expect(auth.hashPassword(password as string)).rejects.toThrow(
        '密碼須為字串且長度為 1～1024 UTF-8 bytes，未產生 hash。',
      );
    },
  );

  it('接受 1024 UTF-8 bytes 的密碼', async () => {
    expect(
      parseSuperUserPasswordHash(await auth.hashPassword('a'.repeat(1024))),
    ).toBeDefined();
  });
});
