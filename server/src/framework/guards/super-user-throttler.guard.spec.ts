import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import type { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { SuperUserThrottlerGuard } from './super-user-throttler.guard';

/** 正式環境取不到 client IP 的情境（socket 位址缺失）無法用 inject 重現，以單元測試鎖定。 */
describe('SuperUserThrottlerGuard', () => {
  it('取不到 client IP 時回 503，不放行也不計數', async () => {
    const warn = jest.fn();
    const increment = jest.fn();
    const guard = new SuperUserThrottlerGuard(
      {
        throttlers: [{ name: 'short', limit: 10, ttl: 60_000 }],
      },
      { increment },
      { getAllAndOverride: () => undefined } as unknown as Reflector,
      { warn } as unknown as AppLoggerService,
    );
    await guard.onModuleInit();
    const context = {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({ ip: undefined, headers: {} }),
        getResponse: () => ({ header: jest.fn() }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: AppErrorCode.AUTH_SUPER_USER_UNAVAILABLE,
      status: 503,
    });
    expect(increment).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { reason: 'no_client_ip' } }),
    );
  });
});
