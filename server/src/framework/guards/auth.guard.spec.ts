import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { AuthService } from '#app/features/auth/services/auth.service';
import { IS_PUBLIC_KEY } from '#app/framework/decorators/public.decorator';
import { CLS_AUDIT_USER_ID } from '#app/infrastructure/database/audit-user.context';
import { AuthGuard } from './auth.guard';

describe('AuthGuard', () => {
  const createContext = (token?: string) => {
    const request = {
      cookies: token ? { [AUTH_COOKIE_NAME]: token } : {},
    } as {
      cookies: Record<string, string>;
      user?: { id: string; sub: string };
    };
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  const createGuard = (isPublic = false) => {
    const verifySessionToken = jest
      .fn()
      .mockResolvedValue({ token: 'token-1', userId: 7 });
    const sessions = {
      verifySessionToken,
    } as unknown as AuthService;
    const setAuditUserId = jest.fn();
    const cls = {
      isActive: jest.fn().mockReturnValue(true),
      set: setAuditUserId,
    } as unknown as ClsService;
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === IS_PUBLIC_KEY ? isPublic : undefined,
      ),
    } as unknown as Reflector;

    return {
      guard: new AuthGuard(sessions, cls, reflector),
      verifySessionToken,
      setAuditUserId,
    };
  };

  it('@Public() 端點不要求 session', async () => {
    const { guard, verifySessionToken } = createGuard(true);

    await expect(guard.canActivate(createContext().context)).resolves.toBe(
      true,
    );
    expect(verifySessionToken).not.toHaveBeenCalled();
  });

  it('未標 Public 的端點即使沒有其他 metadata 仍只驗證 session', async () => {
    const { guard, verifySessionToken, setAuditUserId } = createGuard();
    const { context, request } = createContext('token-1');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifySessionToken).toHaveBeenCalledWith('token-1');
    expect(request.user).toEqual({ id: '7', sub: '7' });
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
    const { guard, verifySessionToken, setAuditUserId } = createGuard();
    const { context, request } = createContext('token-1');
    verifySessionToken.mockResolvedValueOnce({ userId });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: AppErrorCode.UNAUTHORIZED,
    });
    expect(request.user).toBeUndefined();
    expect(setAuditUserId).not.toHaveBeenCalled();
  });

  it('無效、停用或 soft-deleted 員工 session 由 verifier fail closed', async () => {
    const { guard, verifySessionToken } = createGuard();
    verifySessionToken.mockResolvedValueOnce(null);

    await expect(
      guard.canActivate(createContext('invalid').context),
    ).rejects.toMatchObject({ code: AppErrorCode.UNAUTHORIZED });
  });

  it('MySQL session 驗證不可用時保留 503，不偽裝為 401', async () => {
    const { guard, verifySessionToken } = createGuard();
    verifySessionToken.mockRejectedValueOnce(
      Object.assign(new Error('db unavailable'), { status: 503 }),
    );

    await expect(
      guard.canActivate(createContext('a'.repeat(43)).context),
    ).rejects.toMatchObject({ status: 503 });
  });
});
