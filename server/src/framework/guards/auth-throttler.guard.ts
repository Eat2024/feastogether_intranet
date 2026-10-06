import {
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  getOptionsToken,
  getStorageToken,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import { AUTH_RATE_LIMIT_MESSAGE } from '#app/features/auth/auth.constants';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';

/**
 * 認證端點速率限制（032）。只掛在統一登入的 start / callback 路由上
 * （`@UseGuards`），不作為全域 guard——一般業務請求量不受影響。
 *
 * 視窗設定於 AuthModule 的 ThrottlerModule.forRootAsync；父類別的 generateKey
 * 會把 class 名 + handler 名 + 視窗名一併雜湊，因此各端點天然各自獨立計數。
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly appLogger: AppLoggerService,
  ) {
    super(options, storageService, reflector);
  }

  protected shouldSkip(context: ExecutionContext): Promise<boolean> {
    const { req } = this.getRequestResponse(context);
    if (typeof req.ip === 'string' && req.ip.length > 0) {
      return Promise.resolve(false);
    }

    this.appLogger.warn({
      context: AuthThrottlerGuard.name,
      event: 'auth.rate_limit_skipped_no_client_ip',
      message: '取不到 client IP，本次請求不套用速率限制',
      metadata: {
        method: req.method,
        path: req.url,
        xForwardedFor: (req.headers as Record<string, unknown> | undefined)?.[
          'x-forwarded-for'
        ],
      },
    });
    return Promise.resolve(true);
  }

  /**
   * 以 client IP 作為限流單位。取不到 IP 的請求已由 shouldSkip 放行，
   * 因此此處必為非空字串。
   *
   * MUST NOT 沿用父類別預設的 `req.ips[0]`：Fastify 的 `req.ips` 是
   * `proxyAddr.all()` 的 closest-first 陣列，`[0]` 為 socket 位址——正式環境
   * 的請求鏈是 `nginx → Next.js(rewrite) → server`，socket 位址等於 Next.js
   * 容器 IP，用它當 key 會讓全體使用者共用同一個計數桶而集體被鎖在系統外。
   * `req.ip` 才是 `trustProxy: 1` 解析後的真實 client IP。
   *
   * 註：官方文件的 proxy 章節以 Express 為前提（`app.set('trust proxy', ...)`），
   * 而 Express 的 `req.ips[0]` 是原始 client——預設值在 Express 正確、Fastify 錯誤。
   */
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    return Promise.resolve(req.ip as string);
  }

  /**
   * 以 AppException 回應，讓 429 走既有 ExceptionHandler 的統一格式（憲章 III），
   * 而非父類別的 ThrottlerException（其 body 形狀與本系統契約不符）。
   */
  protected throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { req, res } = this.getRequestResponse(context);
    this.setStandardRetryAfter(res, detail);
    this.logRateLimited(req, detail);

    // 回傳 rejected promise 而非同步 throw：父類別以 `await` 呼叫本方法，
    // 覆寫時必須維持相同的 Promise 契約，呼叫端才能一律用 .catch/await 接。
    return Promise.reject(
      new AppException(
        AppErrorCode.REFUSE_SERVICE,
        AUTH_RATE_LIMIT_MESSAGE,
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );
  }

  /**
   * 父類別對具名 throttler 只會送出 `Retry-After-short` / `Retry-After-long`
   * （見其 getThrottlerSuffix），標準 `Retry-After` 需自行補上。
   */
  private setStandardRetryAfter(
    res: Record<string, unknown>,
    detail: ThrottlerLimitDetail,
  ): void {
    const header = res.header as (name: string, value: string) => void;
    header.call(res, 'Retry-After', String(detail.timeToBlockExpire));
  }

  /**
   * 記錄被擋下的嘗試。原始 `x-forwarded-for` 一併留存：日後代理層若被改動而
   * 導致 IP 解析退化，這是唯一能事後察覺的線索。
   */
  private logRateLimited(
    req: Record<string, unknown>,
    detail: ThrottlerLimitDetail,
  ): void {
    const headers = req.headers as Record<string, unknown>;
    this.appLogger.warn({
      context: AuthThrottlerGuard.name,
      event: 'auth.rate_limited',
      message: '認證端點請求過於頻繁，已擋下',
      metadata: {
        ip: req.ip,
        method: req.method,
        path: req.url,
        xForwardedFor: headers['x-forwarded-for'],
        limit: detail.limit,
        totalHits: detail.totalHits,
        retryAfterSeconds: detail.timeToBlockExpire,
      },
    });
  }
}
