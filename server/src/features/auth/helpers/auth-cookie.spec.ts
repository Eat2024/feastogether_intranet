import { AUTH_COOKIE_NAME } from '../auth.constants';
import { clearAuthCookie, setAuthCookie } from './auth-cookie';

describe('auth cookie', () => {
  it.each([
    ['development', false],
    ['production', true],
    ['staging', true],
  ])('%s 使用 host-only HttpOnly SameSite=Lax 固定 8 小時', (env, secure) => {
    const reply = { setCookie: jest.fn() };
    setAuthCookie(
      reply as never,
      { get: jest.fn().mockReturnValue(env) } as never,
      'token',
    );
    expect(reply.setCookie).toHaveBeenCalledWith(AUTH_COOKIE_NAME, 'token', {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 28_800,
    });
  });

  it('清除 cookie 不設定 Domain', () => {
    const reply = { clearCookie: jest.fn() };
    clearAuthCookie(reply as never);
    expect(reply.clearCookie).toHaveBeenCalledWith(AUTH_COOKIE_NAME, {
      path: '/',
    });
  });
});
