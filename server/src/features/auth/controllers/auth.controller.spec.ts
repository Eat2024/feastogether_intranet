import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  AUTH_COOKIE_NAME,
  OAUTH_TX_COOKIE_NAME,
} from '#app/features/auth/auth.constants';
import { AuthController } from './auth.controller';

describe('AuthController retained contract', () => {
  const makeController = (env: Record<string, string> = {}) => {
    const auth = {
      getMe: jest.fn().mockResolvedValue({
        user: { id: 7, empId: '00123', name: '王小明' },
      }),
    };
    const logout = { logout: jest.fn().mockResolvedValue({}) };
    const dev = {
      login: jest.fn().mockResolvedValue({
        accessToken: 'jwt',
        session: { user: { id: 7 } },
      }),
    };
    return {
      controller: new AuthController(
        auth as never,
        logout as never,
        dev as never,
        {
          get: (key: string) => env[key],
        } as never,
      ),
      auth,
      logout,
      dev,
    };
  };

  it('login options 維持 OAuth 未啟用', () => {
    expect(
      makeController({ DEVMOD: 'true' }).controller.loginOptions(),
    ).toEqual({ oauth: false, devLogin: true });
  });

  it('/me 回應不含 role、permission、navigation 或本地備註', async () => {
    const { controller } = makeController();
    const result = await controller.me({
      user: { id: '7' },
      cookies: { [AUTH_COOKIE_NAME]: 'token' },
    } as unknown as FastifyRequest & { user: { id: string } });
    expect(result).toEqual({
      user: { id: 7, empId: '00123', name: '王小明' },
    });
    expect(result).not.toHaveProperty('role');
    expect(result).not.toHaveProperty('permissions');
    expect(result).not.toHaveProperty('navigation');
    expect(result.user).not.toHaveProperty('description');
  });

  it('logout 清除兩個 cookie', async () => {
    const { controller } = makeController();
    const reply = { clearCookie: jest.fn() } as unknown as FastifyReply & {
      clearCookie: jest.Mock;
    };
    await controller.logout(
      { cookies: { [AUTH_COOKIE_NAME]: 'token' } } as FastifyRequest,
      reply,
    );
    expect(reply.clearCookie).toHaveBeenCalledWith(AUTH_COOKIE_NAME, {
      path: '/',
    });
    expect(reply.clearCookie).toHaveBeenCalledWith(OAUTH_TX_COOKIE_NAME, {
      path: '/',
    });
  });
});
