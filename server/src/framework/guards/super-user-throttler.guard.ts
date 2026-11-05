import { ExecutionContext, Injectable } from '@nestjs/common';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { AuthThrottlerGuard } from './auth-throttler.guard';

/**
 * 維護登入限流：沿用 AuthThrottlerGuard 的 client IP tracker、視窗與 429 回應；
 * 桶由 class＋handler 決定，不含 entryKey。與員工登入不同，取不到 client IP 或
 * 限流儲存不可用時一律 503，不放行。
 */
@Injectable()
export class SuperUserThrottlerGuard extends AuthThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await super.canActivate(context);
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw this.unavailable('storage_unavailable');
    }
  }

  protected shouldSkip(context: ExecutionContext): Promise<boolean> {
    const { req } = this.getRequestResponse(context);
    if (typeof req.ip === 'string' && req.ip.length > 0) {
      return Promise.resolve(false);
    }
    return Promise.reject(this.unavailable('no_client_ip'));
  }

  /** 503 本身不帶原因；只在安全 log 記故障類別，不記路徑或入口。 */
  private unavailable(reason: string): AppException {
    this.appLogger.warn({
      context: SuperUserThrottlerGuard.name,
      event: 'auth.super_user_rate_limit_unavailable',
      message: '維護登入限流無法套用，已拒絕',
      metadata: { reason },
    });
    return new AppException(...AppErrors.AUTH_SUPER_USER_UNAVAILABLE);
  }
}
