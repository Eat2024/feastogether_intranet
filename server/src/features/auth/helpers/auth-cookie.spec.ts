import { AUTH_COOKIE_NAME } from '../auth.constants';
import { clearAuthCookie, setAuthCookie } from './auth-cookie';

const configFor = (env: string) =>
  ({ get: jest.fn().mockReturnValue(env) }) as never;

describe('auth cookie', () => {
  it.each([
    ['development', false, 'lax'],
    ['production', true, 'none'],
    ['staging', true, 'none'],
  ])(
    '%s 使用 host-only HttpOnly 固定 8 小時（HTTPS 環境 SameSite=None 供 iframe 嵌入）',
    (env, secure, sameSite) => {
      const reply = { setCookie: jest.fn() };
      setAuthCookie(reply as never, configFor(env), 'token');
      expect(reply.setCookie).toHaveBeenCalledWith(AUTH_COOKIE_NAME, 'token', {
        httpOnly: true,
        secure,
        sameSite,
        path: '/',
        maxAge: 28_800,
      });
    },
  );

  it.each([
    ['development', false, 'lax'],
    ['staging', true, 'none'],
  ])(
    '%s 清除 cookie 的屬性與寫入時一致且不設定 Domain',
    (env, secure, sameSite) => {
      const reply = { clearCookie: jest.fn() };
      clearAuthCookie(reply as never, configFor(env));
      expect(reply.clearCookie).toHaveBeenCalledWith(AUTH_COOKIE_NAME, {
        httpOnly: true,
        secure,
        sameSite,
        path: '/',
      });
    },
  );
});
