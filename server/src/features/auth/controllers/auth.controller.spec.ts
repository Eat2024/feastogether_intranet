import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  AUTH_COOKIE_NAME,
  OAUTH_TX_COOKIE_NAME,
} from '#app/features/auth/auth.constants';
import { AuthController } from './auth.controller';

/**
 * AuthController 接線測：確認自 cookie 取 token、自 req.user 取 id，原樣委派 service。
 * AuthGuard（401）為框架行為，由 auth.guard.spec 覆蓋。
 */
const makeReq = (over: Partial<{ cookies: object; user: object }> = {}) =>
  ({
    cookies: { [AUTH_COOKIE_NAME]: 'session-token' },
    user: { id: '7' },
    ...over,
  }) as unknown as FastifyRequest & { user?: { id: string } };

const makeReply = () =>
  ({
    clearCookie: jest.fn(),
    setCookie: jest.fn(),
  }) as unknown as FastifyReply & {
    clearCookie: jest.Mock;
    setCookie: jest.Mock;
  };

const makeController = (
  over: {
    authService?: object;
    logoutService?: object;
    devLoginService?: object;
    env?: Record<string, string>;
  } = {},
) =>
  new AuthController(
    (over.authService ?? {}) as never,
    (over.logoutService ?? {}) as never,
    (over.devLoginService ?? {}) as never,
    { get: (key: string) => over.env?.[key] } as never,
  );

describe('AuthController.logout', () => {
  it('先清 auth 與 OAuth 交易 cookie，再以 cookie token 委派登出服務（不信 req.user）', async () => {
    const logoutService = {
      logout: jest.fn().mockResolvedValue({
        localLogout: 'completed',
        upstreamLogout: 'confirmed',
      }),
    };
    const controller = makeController({ logoutService });
    const reply = makeReply();

    const result = await controller.logout(makeReq({ user: undefined }), reply);

    expect(result).toEqual({
      localLogout: 'completed',
      upstreamLogout: 'confirmed',
    });
    expect(logoutService.logout).toHaveBeenCalledWith('session-token');
    expect(reply.clearCookie).toHaveBeenCalledWith(AUTH_COOKIE_NAME, {
      path: '/',
    });
    expect(reply.clearCookie).toHaveBeenCalledWith(OAUTH_TX_COOKIE_NAME, {
      path: '/',
    });
  });

  it('無 cookie → 以 null 委派（服務回 not_attempted）', async () => {
    const logoutService = { logout: jest.fn().mockResolvedValue({}) };
    const controller = makeController({ logoutService });

    await controller.logout(makeReq({ cookies: {} }), makeReply());

    expect(logoutService.logout).toHaveBeenCalledWith(null);
  });
});

describe('AuthController.me', () => {
  it('me：帶 userId 與 cookie token 委派 getMe', async () => {
    const authService = {
      getMe: jest.fn().mockResolvedValue({ user: { id: 7 } }),
    };
    const controller = makeController({ authService });

    await controller.me(makeReq());

    expect(authService.getMe).toHaveBeenCalledWith(7, 'session-token');
  });
});

describe('AuthController.loginOptions / devLogin', () => {
  it('loginOptions：OAuth 固定停用，devLogin 依 DEVMOD', () => {
    expect(makeController().loginOptions()).toEqual({
      oauth: false,
      devLogin: false,
    });
    expect(
      makeController({
        env: { DEVMOD: 'true' },
      }).loginOptions(),
    ).toEqual({ oauth: false, devLogin: true });
    expect(
      makeController({
        env: { DEVMOD: 'true', NODE_ENV: 'production' },
      }).loginOptions().devLogin,
    ).toBe(false);
  });

  it('devLogin：委派服務、設 HttpOnly 登入 cookie，只回 session（不含 token）', async () => {
    const devLoginService = {
      login: jest.fn().mockResolvedValue({
        accessToken: 'dev-jwt',
        session: { user: { id: 99 } },
      }),
    };
    const controller = makeController({ devLoginService });
    const reply = makeReply();

    const result = await controller.devLogin(reply);

    expect(result).toEqual({ user: { id: 99 } });
    expect(reply.setCookie).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      'dev-jwt',
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
  });
});
