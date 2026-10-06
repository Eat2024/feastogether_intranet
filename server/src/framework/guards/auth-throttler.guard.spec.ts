import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type {
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import type {
  AppLogInput,
  AppLoggerService,
} from '#app/infrastructure/logging/appLog/app-logger.service';
import { AuthThrottlerGuard } from './auth-throttler.guard';

/** 被測方法在父類別為 protected，測試以此形狀取用。 */
interface GuardInternals {
  shouldSkip(context: ExecutionContext): Promise<boolean>;
  getTracker(req: Record<string, unknown>): Promise<string>;
  throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void>;
}

const createGuard = () => {
  const warn = jest.fn();
  const appLogger = { warn } as unknown as AppLoggerService;
  const options: ThrottlerModuleOptions = { throttlers: [] };
  const guard = new AuthThrottlerGuard(
    options,
    {} as ThrottlerStorage,
    {} as Reflector,
    appLogger,
  );
  return { guard: guard as unknown as GuardInternals, warn };
};

const createContext = (
  req: Record<string, unknown>,
  res: Record<string, unknown>,
) =>
  ({
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  }) as unknown as ExecutionContext;

const detail = (): ThrottlerLimitDetail => ({
  ttl: 60000,
  limit: 10,
  key: 'hashed-key',
  tracker: '203.0.113.9',
  totalHits: 11,
  timeToExpire: 42,
  isBlocked: true,
  timeToBlockExpire: 42,
});

describe('AuthThrottlerGuard', () => {
  describe('getTracker', () => {
    // 回歸守衛：父類別預設實作為 `req.ips[0]`，但 Fastify 的 req.ips 是
    // proxyAddr.all() 的 closest-first 陣列——[0] 是 socket 位址（正式環境為
    // Next.js 容器 IP），會讓所有使用者共用同一個計數桶而集體被鎖。
    it('取 req.ip，而非 req.ips[0]（後者是代理層位址）', async () => {
      const { guard } = createGuard();

      const tracker = await guard.getTracker({
        ip: '203.0.113.9',
        ips: ['172.18.0.5', '203.0.113.9'],
      });

      expect(tracker).toBe('203.0.113.9');
    });

    it('不同 client IP 產生不同 tracker（額度不互相消耗）', async () => {
      const { guard } = createGuard();
      const shared = ['172.18.0.5'];

      const a = await guard.getTracker({ ip: '203.0.113.1', ips: shared });
      const b = await guard.getTracker({ ip: '203.0.113.2', ips: shared });

      expect(a).not.toBe(b);
    });
  });

  describe('shouldSkip', () => {
    it('有 client IP 時照常限流', async () => {
      const { guard } = createGuard();

      const skipped = await guard.shouldSkip(
        createContext({ ip: '203.0.113.9' }, {}),
      );

      expect(skipped).toBe(false);
    });

    // 併進共用 tracker 會讓「IP 解析退化」升級成全體登入者共用一個桶而集體被鎖，
    // 那正是本 guard 要避免的失敗模式；放行的風險遠低於誤鎖全站。
    it('取不到 client IP 時放行、不限流', async () => {
      const { guard } = createGuard();

      const skipped = await guard.shouldSkip(
        createContext({ url: '/api/auth/login', method: 'POST' }, {}),
      );

      expect(skipped).toBe(true);
    });

    it('放行時記 warn，讓解析退化不會無聲無息', async () => {
      const { guard, warn } = createGuard();

      await guard.shouldSkip(
        createContext({ url: '/api/auth/login', method: 'POST' }, {}),
      );

      const [logged] = warn.mock.calls[0] as [AppLogInput];
      expect(logged.event).toBe('auth.rate_limit_skipped_no_client_ip');
    });
  });

  describe('throwThrottlingException', () => {
    const run = async () => {
      const { guard, warn } = createGuard();
      const header = jest.fn();
      const context = createContext(
        {
          ip: '203.0.113.9',
          url: '/api/auth/login',
          method: 'POST',
          headers: { 'x-forwarded-for': '203.0.113.9' },
        },
        { header },
      );

      const error = await guard
        .throwThrottlingException(context, detail())
        .then(
          () => undefined,
          (thrown: unknown) => thrown,
        );

      return { error, header, warn };
    };

    it('丟出統一契約的 AppException（REFUSE_SERVICE / 429）', async () => {
      const { error } = await run();

      expect(error).toBeInstanceOf(AppException);
      const appError = error as AppException;
      expect(appError.code).toBe(AppErrorCode.REFUSE_SERVICE);
      expect(appError.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    // 父類別對具名 throttler 只送出 `Retry-After-short`，標準 header 需自行補上。
    it('補上標準 Retry-After header', async () => {
      const { header } = await run();

      expect(header).toHaveBeenCalledWith('Retry-After', '42');
    });

    it('記 auth.rate_limited，含 ip、path 與原始 x-forwarded-for', async () => {
      const { warn } = await run();

      const [logged] = warn.mock.calls[0] as [AppLogInput];
      expect(logged.event).toBe('auth.rate_limited');
      expect(logged.metadata).toMatchObject({
        ip: '203.0.113.9',
        path: '/api/auth/login',
        xForwardedFor: '203.0.113.9',
      });
    });

    it('訊息不洩漏帳號是否存在或剩餘額度', async () => {
      const { error } = await run();

      expect((error as AppException).message).not.toMatch(/\d/);
    });
  });
});
