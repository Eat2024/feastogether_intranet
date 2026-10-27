import { HttpStatus } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AUTH_COOKIE_NAME } from '../auth.constants';
import { AuthController } from './auth.controller';

describe('AuthController WebView boundary', () => {
  const setup = (env: Record<string, string> = {}) => {
    const auth = {
      createWebviewLaunch: jest.fn().mockResolvedValue({ launchUrl: 'url' }),
      activateWebviewSession: jest.fn().mockResolvedValue('s'.repeat(43)),
      getMe: jest.fn().mockResolvedValue({ user: { id: 7 } }),
      logout: jest.fn().mockResolvedValue({ localLogout: 'completed' }),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'NODE_ENV' ? 'development' : env[key],
      ),
    };
    return {
      controller: new AuthController(auth as never, config as never),
      auth,
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
    const { controller, auth } = setup();
    const response = reply();
    controller.getWebviewBridge(
      { code: 'a'.repeat(43) },
      response as unknown as FastifyReply,
    );
    expect(auth.createWebviewLaunch).not.toHaveBeenCalled();
    expect(auth.activateWebviewSession).not.toHaveBeenCalled();
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

  it('POST session 只接受單一 code 欄位並回固定 303', async () => {
    const { controller, auth } = setup();
    const response = reply();
    await controller.createSession(
      { code: 'a'.repeat(43) },
      response as unknown as FastifyReply,
    );
    expect(auth.activateWebviewSession).toHaveBeenCalledWith('a'.repeat(43));
    expect(response.setCookie).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      's'.repeat(43),
      expect.objectContaining({ httpOnly: true, maxAge: 28_800 }),
    );
    expect(response.redirect).toHaveBeenCalledWith('/', HttpStatus.SEE_OTHER);
  });

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

  it('DELETE session 先清 cookie，再由 AuthService 冪等撤銷', async () => {
    const { controller, auth } = setup();
    const response = reply();
    await expect(
      controller.deleteSession(
        { cookies: { [AUTH_COOKIE_NAME]: 'a'.repeat(43) } } as FastifyRequest,
        response as unknown as FastifyReply,
      ),
    ).resolves.toEqual({ localLogout: 'completed' });
    expect(response.clearCookie).toHaveBeenCalledWith(AUTH_COOKIE_NAME, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });
    expect(auth.logout).toHaveBeenCalledWith('a'.repeat(43));
  });
});
