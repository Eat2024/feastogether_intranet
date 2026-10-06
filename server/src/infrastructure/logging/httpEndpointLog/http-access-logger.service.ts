import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { getSlowThresholdMs } from '#app/infrastructure/logging/logHelper/logger.config';

export interface HttpAccessLogEntry {
  type: 'http_access';
  method: string;
  path: string;
  url: string;
  query?: unknown;
  statusCode: number;
  requestAt: string;
  responseAt: string;
  durationMs: number;
  ip?: string;
  userAgent?: string;
  requestBody?: unknown;
}

/**
 * 收 interceptor 組好的 HTTP access payload，補 slow 標記、依 status 選 level 後交 pino。
 * requestId / userId 由 pino mixin 自動帶入。
 */
@Injectable()
export class HttpAccessLoggerService {
  private readonly slowThresholdMs: number;

  constructor(
    private readonly logger: PinoLogger,
    config: ConfigService,
  ) {
    this.slowThresholdMs = getSlowThresholdMs(config);
  }

  write(entry: HttpAccessLogEntry): void {
    const payload: Record<string, unknown> = { ...entry };
    if (entry.durationMs >= this.slowThresholdMs) {
      payload.isSlow = true;
      payload.slowThresholdMs = this.slowThresholdMs;
    }

    if (entry.statusCode >= 500) {
      this.logger.error(payload);
    } else if (entry.statusCode >= 400) {
      this.logger.warn(payload);
    } else {
      this.logger.info(payload);
    }
  }
}
