import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import {
  AppLoggerService,
  type AppLogInput,
} from '#app/infrastructure/logging/appLog/app-logger.service';
import { getErrorType } from '#app/infrastructure/logging/logHelper/error-type';
import { maskSensitive } from '#app/infrastructure/logging/logHelper/log-masker';
import { FeastogetherConfig } from './feastogether.config';

type FeastogetherMethod = 'get' | 'post';

export interface FeastogetherRequestOptions {
  /** 帶上使用者的饗賓 access_token 做 Bearer（per-user 端點用）。 */
  token?: string;
}

/** 饗賓固定回應格式；實際 payload 在 `data`。 */
export interface FeastogetherEnvelope<T> {
  success: boolean;
  code?: string;
  message?: string;
  data: T;
  meta?: unknown;
}

/**
 * 饗賓 API 錯誤：保留上游 HTTP status，供各 service 對應到正確的本系統 error code
 * （例如 401/403→授權失效、其餘/連線失敗→不可用）。
 */
export class FeastogetherApiError extends Error {
  constructor(
    readonly status: number | null,
    readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'FeastogetherApiError';
  }
}

/**
 * 饗賓 API 集中傳輸層：唯一注入 base URL 與 X-API-KEY 之處。
 * 各 domain service 只給相對 path 與（需要時）使用者 token；不碰 header / base URL。
 *
 * 直接用 HttpService(axios)，保留 HTTP status 供各 domain service 做錯誤對應。
 */
@Injectable()
export class FeastogetherClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: FeastogetherConfig,
    private readonly logger: AppLoggerService,
  ) {}

  get<T = unknown>(
    path: string,
    options: FeastogetherRequestOptions = {},
  ): Promise<T> {
    return this.request<T>('get', path, undefined, options);
  }

  post<T = unknown>(
    path: string,
    body: unknown,
    options: FeastogetherRequestOptions = {},
  ): Promise<T> {
    return this.request<T>('post', path, body, options);
  }

  private async request<T>(
    method: FeastogetherMethod,
    path: string,
    body: unknown,
    options: FeastogetherRequestOptions,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-KEY': this.config.apiKey,
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    const url = `${this.config.baseUrl}${path}`;
    try {
      const response =
        method === 'get'
          ? await firstValueFrom(
              this.http.get<FeastogetherEnvelope<T>>(url, { headers }),
            )
          : await firstValueFrom(
              this.http.post<FeastogetherEnvelope<T>>(url, body, { headers }),
            );
      return this.unwrap<T>(response.data, method, path, body);
    } catch (error: unknown) {
      if (error instanceof FeastogetherApiError) throw error;

      const status = isAxiosError(error)
        ? (error.response?.status ?? null)
        : null;
      const responseBody: unknown = isAxiosError(error)
        ? (error.response?.data ?? null)
        : null;
      // 集中記錄上游失敗：AppException(502) 是 HttpException，ExceptionHandler 不記，
      // 故保留可觀測欄位，但不得寫入可能含 token、密碼或個資的原始 body/message。
      this.safeWarn({
        event: 'feastogether.request_failed',
        message: `饗賓 API ${method.toUpperCase()} ${path} 失敗`,
        context: FeastogetherClient.name,
        metadata: {
          method,
          path,
          status,
          errorType: getErrorType(error),
          ...(body !== undefined ? { requestBody: maskSensitive(body) } : {}),
          responseBody: maskSensitive(responseBody),
        },
      });
      throw new FeastogetherApiError(
        status,
        responseBody,
        `饗賓 API ${method.toUpperCase()} ${path} ${status ? '失敗' : '連線失敗'}`,
      );
    }
  }

  private unwrap<T>(
    payload: FeastogetherEnvelope<T>,
    method: FeastogetherMethod,
    path: string,
    requestBody: unknown,
  ): T {
    if (payload && typeof payload === 'object' && 'success' in payload) {
      if (payload.success === false) {
        this.safeWarn({
          event: 'feastogether.request_failed',
          message: `饗賓 API ${method.toUpperCase()} ${path} 回傳 success=false`,
          context: FeastogetherClient.name,
          metadata: {
            method,
            path,
            upstreamCode: payload.code,
            ...(requestBody !== undefined
              ? { requestBody: maskSensitive(requestBody) }
              : {}),
            responseBody: maskSensitive(payload),
          },
        });
        throw new FeastogetherApiError(
          null,
          payload,
          `饗賓 API ${method.toUpperCase()} ${path} 回傳 success=false`,
        );
      }
      return payload.data;
    }
    return payload;
  }

  private safeWarn(input: AppLogInput): void {
    try {
      this.logger.warn(input);
    } catch {
      // logging 失敗不得改變第三方 API 呼叫的錯誤語意。
    }
  }
}
