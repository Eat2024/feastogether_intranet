import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { AuthSessionVerifierService } from '#app/features/auth/services/auth-session-verifier.service';
import { ApiAuthorizationService } from '#app/features/auth/services/api-authorization.service';
import { IS_PUBLIC_KEY } from '#app/framework/decorators/public.decorator';
import { REGISTER_API_KEY } from '#app/framework/decorators/register-api.decorator';
import { AuthGuard } from './auth.guard';

describe('AuthGuard', () => {
  const createContext = (token?: string) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
          cookies: token ? { [AUTH_COOKIE_NAME]: token } : {},
        }),
      }),
    }) as unknown as ExecutionContext;

  const createGuard = (
    options: {
      isPublic?: boolean;
      register?: { key: string; name: string; permissions: string[] };
      allowed?: boolean;
    } = {},
  ) => {
    const verify = jest.fn().mockResolvedValue({ userId: 1 });
    const verifyToken = jest.fn().mockResolvedValue({ userId: 1 });
    const verifySessionToken = jest
      .fn()
      .mockResolvedValue({ token: 'token-1', userId: 1 });
    const sessions = {
      verify,
      verifyToken,
      verifySessionToken,
    } as unknown as AuthSessionVerifierService;

    const cls = {
      isActive: jest.fn().mockReturnValue(false),
      set: jest.fn(),
    } as unknown as ClsService;

    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === IS_PUBLIC_KEY
          ? !!options.isPublic
          : key === REGISTER_API_KEY
            ? options.register
            : undefined,
      ),
    } as unknown as Reflector;

    const hasAnyPermission = jest.fn().mockResolvedValue(!!options.allowed);
    const authorization = {
      hasAnyPermission,
    } as unknown as ApiAuthorizationService;
    const appLogger = { warn: jest.fn() } as unknown as AppLoggerService;

    return {
      guard: new AuthGuard(sessions, authorization, cls, reflector, appLogger),
      verify,
      verifyToken,
      verifySessionToken,
      hasAnyPermission,
    };
  };

  it('缺少 token 時拒絕（UNAUTHORIZED）', async () => {
    const { guard } = createGuard();

    await expect(guard.canActivate(createContext())).rejects.toMatchObject({
      code: AppErrorCode.UNAUTHORIZED,
    });
  });

  it('帶有效 token 時通過', async () => {
    const { guard, verifySessionToken } = createGuard({
      register: { key: 'auth.me', name: '登入資訊', permissions: [] },
    });

    await expect(guard.canActivate(createContext('token-1'))).resolves.toBe(
      true,
    );
    expect(verifySessionToken).toHaveBeenCalledWith('token-1');
  });

  it('@Public 端點免 token 放行', async () => {
    const { guard, verify } = createGuard({ isPublic: true });

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it('session 驗證失敗時丟 UNAUTHORIZED', async () => {
    const { guard, verifySessionToken } = createGuard();
    verifySessionToken.mockResolvedValueOnce(null);

    await expect(guard.canActivate(createContext('bad'))).rejects.toMatchObject(
      { code: AppErrorCode.UNAUTHORIZED },
    );
  });

  const REGISTER = {
    key: 'roles.list',
    name: '角色列表',
    permissions: ['roleManagement.view'],
  };

  it('缺 @RegisterApi 的受保護端點 → default-deny FORBIDDEN', async () => {
    const { guard } = createGuard();

    await expect(
      guard.canActivate(createContext('token-1')),
    ).rejects.toMatchObject({ code: AppErrorCode.FORBIDDEN });
  });

  it('permissions 空陣列時，有效登入者直接放行', async () => {
    const { guard, hasAnyPermission } = createGuard({
      register: { ...REGISTER, permissions: [] },
    });

    await expect(guard.canActivate(createContext('token-1'))).resolves.toBe(
      true,
    );
    expect(hasAnyPermission).not.toHaveBeenCalled();
  });

  it('擁有任一 API permission 時放行', async () => {
    const { guard, hasAnyPermission } = createGuard({
      register: REGISTER,
      allowed: true,
    });

    await expect(guard.canActivate(createContext('token-1'))).resolves.toBe(
      true,
    );
    expect(hasAnyPermission).toHaveBeenCalledWith(1, REGISTER.permissions);
  });

  it('沒有 API permission 時回 FORBIDDEN', async () => {
    const { guard } = createGuard({ register: REGISTER });

    await expect(
      guard.canActivate(createContext('token-1')),
    ).rejects.toMatchObject({ code: AppErrorCode.FORBIDDEN });
  });
});
