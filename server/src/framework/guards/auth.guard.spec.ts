import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import type { AuthenticatedSession } from '#app/features/auth/auth.types';
import { SessionService } from '#app/features/auth/services/session.service';
import { ALLOW_SUPER_USER_KEY } from '#app/framework/decorators/allow-super-user.decorator';
import { IS_PUBLIC_KEY } from '#app/framework/decorators/public.decorator';
import { CLS_AUDIT_USER_ID } from '#app/infrastructure/database/audit-user.context';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';

const expiresAt = new Date('2026-11-05T12:00:00Z');
const employeeSession = (userId: unknown) =>
  ({
    actor: { kind: 'employee', userId },
    user: { id: userId },
    expiresAt,
  }) as unknown as AuthenticatedSession;
const superUserSession: AuthenticatedSession = {
  actor: { kind: 'super_user' },
  user: null,
  expiresAt,
};

describe('AuthGuard', () => {
  const createContext = (token?: string) => {
    const request = {
      cookies: token ? { [AUTH_COOKIE_NAME]: token } : {},
    } as unknown as AuthenticatedRequest;
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  const createGuard = (metadata: Record<string, boolean> = {}) => {
    const authenticate = jest.fn().mockResolvedValue(employeeSession(7));
    const setAuditUserId = jest.fn();
    const cls = {
      isActive: jest.fn().mockReturnValue(true),
      set: setAuditUserId,
    } as unknown as ClsService;
    const reflector = {
      getAllAndOverride: jest.fn((key: string) => metadata[key]),
    } as unknown as Reflector;

    return {
      guard: new AuthGuard(
        { authenticate } as unknown as SessionService,
        cls,
        reflector,
      ),
      authenticate,
      setAuditUserId,
    };
  };

  it('@Public() 端點不要求 session', async () => {
    const { guard, authenticate } = createGuard({ [IS_PUBLIC_KEY]: true });

    await expect(guard.canActivate(createContext().context)).resolves.toBe(
      true,
    );
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('員工會話掛上 request.user、CLS 稽核員工與已驗證會話', async () => {
    const { guard, authenticate, setAuditUserId } = createGuard();
    const { context, request } = createContext('token-1');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authenticate).toHaveBeenCalledWith('token-1');
    expect(request.user).toEqual({ id: '7', sub: '7' });
    expect(request.authSession).toEqual(employeeSession(7));
    expect(setAuditUserId).toHaveBeenCalledWith(CLS_AUDIT_USER_ID, '7');
  });

  it('缺少 token 時回 UNAUTHORIZED', async () => {
    const { guard } = createGuard();

    await expect(
      guard.canActivate(createContext().context),
    ).rejects.toMatchObject({ code: AppErrorCode.UNAUTHORIZED });
  });

  it.each([
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    '7',
    undefined,
  ])('拒絕無效使用者 ID %s，且不掛載身分或稽核使用者', async (userId) => {
    const { guard, authenticate, setAuditUserId } = createGuard();
    const { context, request } = createContext('token-1');
    authenticate.mockResolvedValueOnce(employeeSession(userId));
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: AppErrorCode.UNAUTHORIZED,
    });
    expect(request.user).toBeUndefined();
    expect(request.authSession).toBeUndefined();
    expect(setAuditUserId).not.toHaveBeenCalled();
  });

  it('無效、過期、撤銷或停用員工的 session 由 SessionService fail closed', async () => {
    const { guard, authenticate } = createGuard();
    authenticate.mockResolvedValueOnce(null);

    await expect(
      guard.canActivate(createContext('invalid').context),
    ).rejects.toMatchObject({ code: AppErrorCode.UNAUTHORIZED });
  });

  it('MySQL session 驗證不可用時保留 503，不偽裝為 401', async () => {
    const { guard, authenticate } = createGuard();
    authenticate.mockRejectedValueOnce(
      Object.assign(new Error('db unavailable'), { status: 503 }),
    );

    await expect(
      guard.canActivate(createContext('a'.repeat(43)).context),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('未明確允許的端點拒絕 Super user（403，不是登入過期），不偽造員工身分', async () => {
    const { guard, authenticate, setAuditUserId } = createGuard();
    const { context, request } = createContext('token-1');
    authenticate.mockResolvedValueOnce(superUserSession);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: AppErrorCode.AUTH_ACTOR_NOT_ALLOWED,
      status: 403,
    });
    expect(request.user).toBeUndefined();
    expect(request.authSession).toBeUndefined();
    expect(setAuditUserId).not.toHaveBeenCalled();
  });

  it('@AllowSuperUser() 端點接受 Super user，只掛已驗證會話，沒有員工 ID', async () => {
    const { guard, authenticate, setAuditUserId } = createGuard({
      [ALLOW_SUPER_USER_KEY]: true,
    });
    const { context, request } = createContext('token-1');
    authenticate.mockResolvedValueOnce(superUserSession);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authSession).toEqual(superUserSession);
    expect(request.user).toBeUndefined();
    expect(setAuditUserId).not.toHaveBeenCalled();
  });

  it('@AllowSuperUser() 端點對員工照常掛員工身分', async () => {
    const { guard } = createGuard({ [ALLOW_SUPER_USER_KEY]: true });
    const { context, request } = createContext('token-1');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: '7', sub: '7' });
  });
});
