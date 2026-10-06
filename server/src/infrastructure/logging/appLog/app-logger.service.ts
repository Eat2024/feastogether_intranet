import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

export interface AppLogInput {
  /** 事件代碼，例如 'auth.jwt_verify_failed'、'redis.recovered' */
  event: string;
  /** 人類可讀訊息 */
  message?: string;
  /** 來源 context（通常為 class 名） */
  context?: string;
  /** 額外結構化資訊 */
  metadata?: Record<string, unknown>;
}

export interface AppLogEntry {
  type: 'app';
  event: string;
  message?: string;
  context?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 純函式：組 app log 結構。
 * 不含 requestId / userId —— 那兩個由 pino mixin 自 CLS 自動補（責任邊界，見 research §3）。
 */
export function buildAppLogEntry(input: AppLogInput): AppLogEntry {
  const entry: AppLogEntry = { type: 'app', event: input.event };
  if (input.message !== undefined) entry.message = input.message;
  if (input.context !== undefined) entry.context = input.context;
  if (input.metadata !== undefined) entry.metadata = input.metadata;
  return entry;
}

/**
 * 業務 / 例外 / 整合 / 基礎設施事件的統一 app logger。
 * 底層走 nestjs-pino；requestId / userId 由 mixin 帶入。
 */
@Injectable()
export class AppLoggerService {
  constructor(private readonly logger: PinoLogger) {}

  info(input: AppLogInput): void {
    this.logger.info(buildAppLogEntry(input));
  }

  warn(input: AppLogInput): void {
    this.logger.warn(buildAppLogEntry(input));
  }

  error(input: AppLogInput): void {
    this.logger.error(buildAppLogEntry(input));
  }
}
