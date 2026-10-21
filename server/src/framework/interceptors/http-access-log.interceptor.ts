import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { catchError, tap } from 'rxjs/operators';
import { throwError } from 'rxjs';
import {
  getRequestPath,
  getRequestUrl,
} from '#app/framework/http/request.context';
import {
  HttpAccessLogEntry,
  HttpAccessLoggerService,
} from '#app/infrastructure/logging/httpEndpointLog/http-access-logger.service';
import { maskSensitive } from '#app/infrastructure/logging/logHelper/log-masker';

/** request body 不記錄完整內容的路徑（login / payment / token 類） */
const BODY_EXCLUDED_PATHS = [
  '/login',
  '/auth/login',
  '/payment',
  '/api/login',
  '/api/auth/login',
  '/api/payment',
  // 038 OAuth：callback body 含一次性授權碼與 state，整筆不記
  '/auth/oauth/start',
  '/auth/oauth/callback',
  '/api/auth/oauth/start',
  '/api/auth/oauth/callback',
  '/auth/webview-launches',
  '/api/auth/webview-launches',
  '/auth/session',
  '/api/auth/session',
  '/external-signature-otps',
  '/api/external-signature-otps',
  '/external-signature-session',
  '/api/external-signature-session',
  '/external-signing-task/rejection',
  '/api/external-signing-task/rejection',
  '/external-signing-task/signatures',
  '/api/external-signing-task/signatures',
];

const QUERY_EXCLUDED_PATHS = [
  '/auth/webview',
  '/api/auth/webview',
  '/auth/webview-launches',
  '/api/auth/webview-launches',
  '/auth/session',
  '/api/auth/session',
  '/external-signature-invitations/:token',
  '/api/external-signature-invitations/:token',
  '/signature-verifications/:token',
  '/api/signature-verifications/:token',
];

/**
 * HTTP access log 收集器：只負責組 `type=http_access` payload 並交 HttpAccessLoggerService。
 * 不擁有整個 log 系統（FR-008）；requestId / userId 由 pino mixin 帶入。
 */
@Injectable()
export class HttpAccessLogInterceptor implements NestInterceptor {
  constructor(private readonly accessLogger: HttpAccessLoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const startAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        this.write(request, startAt, reply.statusCode || HttpStatus.OK);
      }),
      catchError((exception: unknown) => {
        const statusCode =
          exception instanceof HttpException
            ? exception.getStatus()
            : HttpStatus.INTERNAL_SERVER_ERROR;
        this.write(request, startAt, statusCode);
        return throwError(() => exception);
      }),
    );
  }

  private write(
    request: FastifyRequest,
    startAt: number,
    statusCode: number,
  ): void {
    const endAt = Date.now();
    const entry: HttpAccessLogEntry = {
      type: 'http_access',
      method: request.method,
      path: getRequestPath(request),
      url: this.safeUrl(request),
      query: this.shouldLogQuery(request)
        ? this.cleanEmptyObject(request.query)
        : undefined,
      statusCode,
      requestAt: new Date(startAt).toISOString(),
      responseAt: new Date(endAt).toISOString(),
      durationMs: endAt - startAt,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      requestBody: this.shouldLogRequestBody(request)
        ? maskSensitive(request.body)
        : undefined,
    };
    this.accessLogger.write(entry);
  }

  private shouldLogQuery(request: FastifyRequest): boolean {
    const path = getRequestPath(request);
    return (
      !/^(\/api)?\/esign(?:\/|$)/.test(path) &&
      !/^(\/api)?\/external-(?:signing-task|signature-(?:otps|session|invitations))(?:\/|$)/.test(
        path,
      ) &&
      !QUERY_EXCLUDED_PATHS.includes(path)
    );
  }

  private safeUrl(request: FastifyRequest): string {
    return this.shouldLogQuery(request)
      ? getRequestUrl(request)
      : getRequestPath(request);
  }

  private shouldLogRequestBody(request: FastifyRequest): boolean {
    // 電子簽請求包含文件 bytes、手寫 PNG 或完整名單，一律不記錄 body。
    if (/^(\/api)?\/esign(?:\/|$)/.test(getRequestPath(request))) return false;
    if (
      /^(\/api)?\/external-(?:signing-task|signature-(?:otps|session|invitations))(?:\/|$)/.test(
        getRequestPath(request),
      )
    )
      return false;
    const body = request.body;
    if (!body || typeof body !== 'object') return false;
    if (Object.keys(body).length === 0) return false;
    return !BODY_EXCLUDED_PATHS.includes(getRequestPath(request));
  }

  private cleanEmptyObject(value: unknown): unknown {
    if (!value) return undefined;
    if (typeof value === 'object' && Object.keys(value).length === 0) {
      return undefined;
    }
    return value;
  }
}
