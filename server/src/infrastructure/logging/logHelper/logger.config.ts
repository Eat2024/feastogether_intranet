import { ConfigService } from '@nestjs/config';
import { stdTimeFunctions } from 'pino';
import type { Params } from 'nestjs-pino';
import { AppEnvironment } from '#app/config/app.environment';

/** slow request 預設門檻（ms）；可由 env LOG_SLOW_MS 覆寫 */
export const DEFAULT_SLOW_MS = 1000;

export function isProd(config: ConfigService): boolean {
  return config.get<string>('NODE_ENV') === AppEnvironment.Production;
}

/** log level：env LOG_LEVEL 優先，缺漏回退 prod=info / dev=debug（FR-007） */
export function getLogLevel(config: ConfigService): string {
  const level = config.get<string>('LOG_LEVEL');
  if (level && level.trim()) return level.trim();
  return isProd(config) ? 'info' : 'debug';
}

/** slow 門檻（ms）：env LOG_SLOW_MS，非法/缺漏回退預設 */
export function getSlowThresholdMs(config: ConfigService): number {
  const raw = config.get<string | number>('LOG_SLOW_MS');
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SLOW_MS;
}

/** top-level 已知敏感欄位的 pino redact path（body 內巢狀遮罩交給 log-masker） */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
];

/**
 * 組 pino options 的靜態部分（不含 mixin —— mixin 需要 CLS，於 LoggingModule factory 注入）。
 * dev 走 pino-pretty，prod 為純 JSON 單行；level 一律小寫（FR-005）。
 */
export function buildPinoHttpOptions(
  config: ConfigService,
): NonNullable<Params['pinoHttp']> {
  const prod = isProd(config);
  return {
    level: getLogLevel(config),
    autoLogging: false, // 關閉 pino-http 自動請求記錄，HTTP access log 只由 interceptor 產生（FR-016）
    // 不把 pino-http 預設的 req/res（含 req-N 計數 id 與全部 headers）黏到每筆 log；
    // 我們的 http_access payload 已含 method/path/url/ip/userAgent，且以 requestId 為唯一追蹤鍵。
    serializers: {
      req: () => undefined,
      res: () => undefined,
    },
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    timestamp: stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '***' },
    // pino-pretty 列在 dependencies（docker compose 以 NODE_ENV=development 跑 pruned image 也需要）；staging（UAT）等
    // 已部署環境一律 JSON，僅本機 development（或未設 NODE_ENV）走 pretty。
    ...(prod || config.get<string>('NODE_ENV') === AppEnvironment.Staging
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: { singleLine: true, translateTime: 'UTC:standard' },
          },
        }),
  };
}
