import { randomBytes } from 'crypto';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { OauthConfig } from './oauth.config';

const validEnv = (): Record<string, string> => ({
  OAUTH_ISSUER: 'https://auth.example.com',
  OAUTH_CLIENT_ID: 'web-client',
  OAUTH_CLIENT_SECRET: 'synthetic-secret',
  OAUTH_REDIRECT_URI: 'https://app.example.com/oauth/callback',
  OAUTH_LOGOUT_URL: 'https://auth.example.com/logout',
  OAUTH_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

const build = (env: Record<string, string | undefined>) =>
  new OauthConfig({ get: (key: string) => env[key] } as never);

/** 執行並取回丟出的錯誤（未丟錯回 undefined）。 */
const thrownBy = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};
const UNAVAILABLE = { code: AppErrorCode.OAUTH_UNAVAILABLE };

describe('OauthConfig', () => {
  it('完整設定 → 建構成功，各 getter 回解析後的值', () => {
    const config = build(validEnv());

    expect(config.issuer.href).toBe('https://auth.example.com/');
    expect(config.redirectUri.pathname).toBe('/oauth/callback');
    expect(config.logoutUrl.pathname).toBe('/logout');
    expect(config.encryptionKey.length).toBe(32);
    expect(config.allowInsecure).toBe(false);
  });

  it.each([
    ['缺 client secret', { OAUTH_CLIENT_SECRET: '' }],
    ['issuer 非 https', { OAUTH_ISSUER: 'http://auth.example.com' }],
    [
      'redirect 含 query',
      { OAUTH_REDIRECT_URI: 'https://app.example.com/oauth/callback?x=1' },
    ],
    [
      'logout 不同 origin',
      { OAUTH_LOGOUT_URL: 'https://other.example.com/logout' },
    ],
    [
      '金鑰長度錯',
      { OAUTH_TOKEN_ENCRYPTION_KEY: randomBytes(8).toString('base64') },
    ],
    ['issuer 不是網址', { OAUTH_ISSUER: 'not a url' }],
  ])('%s → 建構即失敗（開機 fail）', (_label, override) => {
    expect(() => build({ ...validEnv(), ...override })).toThrow(
      expect.objectContaining({ code: AppErrorCode.OAUTH_UNAVAILABLE }),
    );
  });

  it('本機 loopback 可用 http issuer，allowInsecure=true', () => {
    const config = build({
      ...validEnv(),
      OAUTH_ISSUER: 'http://localhost:4000',
      OAUTH_LOGOUT_URL: 'http://localhost:4000/logout',
    });

    expect(config.allowInsecure).toBe(true);
  });

  it('完全未設定且未開 DEVMOD → 建構即失敗', () => {
    expect(thrownBy(() => build({}))).toMatchObject(UNAVAILABLE);
  });

  it('DEVMOD 開放且完全未設定 → 可開機、configured=false，取設定時才回 OAUTH_UNAVAILABLE', () => {
    const config = build({
      DEVMOD: 'true',
      // .env.example 預設帶的 redirect URI 不算「有設定」
      OAUTH_REDIRECT_URI: 'http://localhost:3000/oauth/callback',
    });

    expect(config.configured).toBe(false);
    expect(thrownBy(() => config.issuer)).toMatchObject(UNAVAILABLE);
  });

  it('DEVMOD 開放但只設一半 → 仍建構失敗（設定錯誤不放過）', () => {
    expect(
      thrownBy(() =>
        build({ DEVMOD: 'true', OAUTH_ISSUER: 'https://auth.example.com' }),
      ),
    ).toMatchObject(UNAVAILABLE);
  });

  it('DEVMOD 開放且完整設定 → configured=true', () => {
    expect(build({ ...validEnv(), DEVMOD: 'true' }).configured).toBe(true);
  });

  it('production 即使 DEVMOD=true 也不放寬（完全未設定 → 建構失敗）', () => {
    expect(
      thrownBy(() => build({ DEVMOD: 'true', NODE_ENV: 'production' })),
    ).toMatchObject(UNAVAILABLE);
  });
});
