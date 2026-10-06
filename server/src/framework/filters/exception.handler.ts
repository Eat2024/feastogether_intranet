import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { apiErrorEnvelope } from '#app/common/http/api-error-response';
import { getRequestUrl } from '#app/framework/http/request.context';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';

interface HttpErrorResponse {
  error?: unknown;
  message?: unknown;
  details?: unknown;
}

@Injectable()
@Catch()
export class ExceptionHandler implements ExceptionFilter {
  constructor(private readonly logger: AppLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const response = ctx.getResponse<FastifyReply>();

    const isHttpException = exception instanceof HttpException;

    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const errorResponse = isHttpException ? exception.getResponse() : undefined;
    const normalizedError =
      typeof errorResponse === 'object' && errorResponse !== null
        ? (errorResponse as HttpErrorResponse)
        : undefined;

    const message =
      typeof errorResponse === 'string'
        ? errorResponse
        : this.toErrorMessage(normalizedError?.message);

    const errorCode = isHttpException
      ? this.toErrorCode(normalizedError?.error)
      : 'INTERNAL_ERROR';

    // 非 HttpException = 未預期錯誤（回 500）：記 error 級含 stack，便於除錯。
    // HttpException 為預期的業務 / 驗證錯誤，不在此噪音記錄。
    if (!isHttpException) {
      const err = exception instanceof Error ? exception : undefined;
      this.logger.error({
        event: 'http.unhandled_exception',
        message: err?.message ?? String(exception),
        context: ExceptionHandler.name,
        metadata: {
          method: request.method,
          path: getRequestUrl(request),
          statusCode: status,
          stack: err?.stack,
        },
      });
    }

    response.status(status).send(
      apiErrorEnvelope({
        code: errorCode,
        message,
        details: normalizedError?.details,
      }),
    );
  }

  private toErrorMessage(message: unknown): string | string[] {
    if (typeof message === 'string') {
      return message;
    }

    if (Array.isArray(message)) {
      return message.filter((item): item is string => typeof item === 'string');
    }

    return 'Internal Server Error';
  }

  private toErrorCode(error: unknown): string {
    return typeof error === 'string' ? error : 'HTTP_ERROR';
  }
}
