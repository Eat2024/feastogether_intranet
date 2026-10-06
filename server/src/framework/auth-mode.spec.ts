import { assertDevModeSafe, isDevLoginAllowed } from './auth-mode';

/** 模擬 ConfigService：只回傳指定的環境變數。 */
const configOf = (env: Record<string, string | undefined>) =>
  ({ get: (key: string) => env[key] }) as never;

describe('isDevLoginAllowed（DEVMOD 開發者登入）', () => {
  it.each([
    ['DEVMOD=true、未設 NODE_ENV（本機 pnpm dev）', { DEVMOD: 'true' }, true],
    [
      'DEVMOD=true、development',
      { DEVMOD: 'true', NODE_ENV: 'development' },
      true,
    ],
    ['DEVMOD=true、test', { DEVMOD: 'true', NODE_ENV: 'test' }, true],
    [
      'DEVMOD=true、production',
      { DEVMOD: 'true', NODE_ENV: 'production' },
      false,
    ],
    ['DEVMOD=true、staging', { DEVMOD: 'true', NODE_ENV: 'staging' }, false],
    ['DEVMOD=false', { DEVMOD: 'false' }, false],
    ['未設 DEVMOD', {}, false],
    ['DEVMOD 非 true 字串', { DEVMOD: '1' }, false],
  ])('%s → %s', (_label, env, expected) => {
    expect(isDevLoginAllowed(configOf(env))).toBe(expected);
  });
});

describe('assertDevModeSafe', () => {
  it.each(['production', 'staging'])(
    '%s 卻設 DEVMOD=true → 丟錯（開機失敗）',
    (nodeEnv) => {
      expect(() =>
        assertDevModeSafe(configOf({ DEVMOD: 'true', NODE_ENV: nodeEnv })),
      ).toThrow(/DEVMOD=true 不可用於 production \/ staging/);
    },
  );

  it.each([
    ['本機 DEVMOD=true', { DEVMOD: 'true' }],
    ['production 未開 DEVMOD', { NODE_ENV: 'production' }],
  ])('%s → 不丟錯', (_label, env) => {
    expect(() => assertDevModeSafe(configOf(env))).not.toThrow();
  });
});
