import { HttpStatus } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { AUTH_COOKIE_NAME, OAUTH_TX_COOKIE_NAME } from '../auth.constants';
import { AuthController } from './auth.controller';

describe('AuthController WebView boundary', () => {
  const setup = (env: Record<string, string> = {}) => {
    const auth = {
      createWebviewLaunch: jest.fn().mockResolvedValue({ launchUrl: 'url' }),
    };
    const sessions = {
      replace: jest.fn().mockResolvedValue({ token: 's'.repeat(43) }),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'NODE_ENV' ? 'development' : env[key],
      ),
    };
    return {
      controller: new AuthController(
        auth as never,
        sessions as never,
        config as never,
      ),
      auth,
      sessions,
    };
  };

  const reply = () => {
    const value = {
      header: jest.fn(),
      status: jest.fn(),
      type: jest.fn(),
      send: jest.fn(),
      redirect: jest.fn(),
      setCookie: jest.fn(),
      clearCookie: jest.fn(),
    };
    value.header.mockReturnValue(value);
    value.status.mockReturnValue(value);
    value.type.mockReturnValue(value);
    return value;
  };

  it('launch 只從 Authorization Bearer 取 JWT', async () => {
    const { controller, auth } = setup();
    await controller.createWebviewLaunch({
      headers: { authorization: 'Bearer signed.jwt.value' },
    } as FastifyRequest);
    expect(auth.createWebviewLaunch).toHaveBeenCalledWith('signed.jwt.value');

    expect(() =>
      controller.createWebviewLaunch({ headers: {} } as FastifyRequest),
    ).toThrow(expect.objectContaining({ status: HttpStatus.UNAUTHORIZED }));
  });

  it('GET bridge 不碰 service，固定同源 action 且保留手動按鈕', () => {
    const { controller, auth, sessions } = setup();
    const response = reply();
    controller.getWebviewBridge(
      { code: 'a'.repeat(43) },
      response as unknown as FastifyReply,
    );
    expect(auth.createWebviewLaunch).not.toHaveBeenCalled();
    expect(sessions.replace).not.toHaveBeenCalled();
    expect(response.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.header).toHaveBeenCalledWith(
      'Referrer-Policy',
      'no-referrer',
    );
    const html = response.send.mock.calls[0][0] as string;
    expect(html).toContain('action="/api/auth/session"');
    expect(html).toContain('<button type="submit">電子簽系統啟動</button>');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });

  const withCookie = (token?: string) =>
    ({
      cookies: token ? { [AUTH_COOKIE_NAME]: token } : {},
    }) as unknown as FastifyRequest;

  it('POST session 以啟動碼替換瀏覽器目前會話，回固定 303', async () => {
    const { controller, sessions } = setup();
    const response = reply();
    await controller.createSession(
      { code: 'a'.repeat(43) },
      withCookie('o'.repeat(43)),
      response as unknown as FastifyReply,
    );
    expect(sessions.replace).toHaveBeenCalledWith('o'.repeat(43), {
      kind: 'webview_launch',
      launchCode: 'a'.repeat(43),
    });
    expect(response.setCookie).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      's'.repeat(43),
      expect.objectContaining({ httpOnly: true, maxAge: 28_800 }),
    );
    expect(response.redirect).toHaveBeenCalledWith('/', HttpStatus.SEE_OTHER);
  });

  it.each([
    {
      case: '舊會話已被取代（409）',
      error: AppErrors.AUTH_SESSION_REPLACED,
      message: AppErrors.AUTH_SESSION_REPLACED[1],
    },
    {
      case: '啟動碼無效（401）',
      error: AppErrors.AUTH_EXCHANGE_FAILED,
      message: AppErrors.AUTH_LAUNCH_INVALID[1],
    },
    {
      case: 'DB 不可用（503）',
      error: AppErrors.AUTH_DB_UNAVAILABLE,
      message: AppErrors.AUTH_DB_UNAVAILABLE[1],
    },
  ])(
    'POST session $case 回固定 HTML 文案且不設 cookie',
    async ({ error, message }) => {
      const { controller, sessions } = setup();
      sessions.replace.mockRejectedValue(new AppException(...error));
      const response = reply();
      await controller.createSession(
        { code: 'a'.repeat(43) },
        withCookie(),
        response as unknown as FastifyReply,
      );
      expect(response.status).toHaveBeenCalledWith(error[2]);
      expect(response.send).toHaveBeenCalledWith(
        expect.stringContaining(message),
      );
      expect(response.setCookie).not.toHaveBeenCalled();
      expect(response.redirect).not.toHaveBeenCalled();
    },
  );

  it('embed-origins 回傳 AUTH_TRUSTED_ORIGINS 設定的 origin', () => {
    const { controller } = setup({
      AUTH_TRUSTED_ORIGINS:
        ' https://portal.example.test , http://localhost:8080 ',
    });
    expect(controller.getEmbedOrigins()).toEqual({
      origins: ['https://portal.example.test', 'http://localhost:8080'],
    });
  });

  it('embed-origins 未設 AUTH_TRUSTED_ORIGINS 時回傳空清單', () => {
    expect(setup().controller.getEmbedOrigins()).toEqual({ origins: [] });
  });

  it('bridge 的 frame-ancestors 與 embed-origins 使用同一份清單', () => {
    const { controller } = setup({
      AUTH_TRUSTED_ORIGINS: 'http://localhost:8080',
    });
    const response = reply();
    controller.getWebviewBridge(
      { code: 'a'.repeat(43) },
      response as unknown as FastifyReply,
    );
    const headers = response.header.mock.calls as Array<[string, string]>;
    const csp = headers.find(
      ([name]) => name === 'Content-Security-Policy',
    )?.[1];
    expect(csp).toContain("frame-ancestors 'self' http://localhost:8080");
  });

  it('DELETE session 先由 SessionService 撤銷，成功後以寫入時屬性清除兩把 cookie', async () => {
    const { controller, sessions } = setup();
    const response = reply();
    await expect(
      controller.deleteSession(
        withCookie('a'.repeat(43)),
        response as unknown as FastifyReply,
      ),
    ).resolves.toEqual({ localLogout: 'completed' });
    expect(sessions.revoke).toHaveBeenCalledWith('a'.repeat(43));
    const attributes = {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    };
    expect(response.clearCookie).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      attributes,
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      OAUTH_TX_COOKIE_NAME,
      attributes,
    );
    expect(sessions.revoke.mock.invocationCallOrder[0]).toBeLessThan(
      response.clearCookie.mock.invocationCallOrder[0],
    );
  });

  it('DELETE session 撤銷失敗時不清 cookie，交給全域錯誤處理', async () => {
    const { controller, sessions } = setup();
    const failure = new AppException(...AppErrors.AUTH_DB_UNAVAILABLE);
    sessions.revoke.mockRejectedValue(failure);
    const response = reply();
    await expect(
      controller.deleteSession(
        withCookie('a'.repeat(43)),
        response as unknown as FastifyReply,
      ),
    ).rejects.toBe(failure);
    expect(response.clearCookie).not.toHaveBeenCalled();
  });
});
