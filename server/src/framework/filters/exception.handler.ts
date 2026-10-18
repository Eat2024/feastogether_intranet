import { AppErrors } from '#app/common/errors/app-errors';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import { apiErrorEnvelope } from '#app/common/http/api-error-response';
import { getRequestPath } from '#app/framework/http/request.context';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';

interface ApiError {
  code: AppErrorCode;
  message: string;
  details?: unknown;
}

/**
 * 框架或套件丟出的 HttpException（路由不存在、JSON 格式錯誤、內容過大等）沒有穩定錯誤碼，
 * 依 HTTP status 對應固定的錯誤碼與繁中訊息，不回傳原始英文訊息或請求路徑。
 */
const FRAMEWORK_ERRORS = {
  [HttpStatus.FORBIDDEN]: AppErrors.HTTP_FORBIDDEN,
  [HttpStatus.NOT_FOUND]: AppErrors.HTTP_NOT_FOUND,
  [HttpStatus.PAYLOAD_TOO_LARGE]: AppErrors.HTTP_PAYLOAD_TOO_LARGE,
};

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

    // 非 HttpException = 未預期錯誤（回 500）：記 error 級含 stack，便於除錯。
    // HttpException 為預期的業務 / 驗證錯誤，不在此噪音記錄。
    if (!isHttpException) {
      const err = exception instanceof Error ? exception : undefined;
      this.logger.error({
        event: 'http.unhandled_exception',
        message: err?.name ?? 'UnknownError',
        context: ExceptionHandler.name,
        metadata: {
          method: request.method,
          path: getRequestPath(request),
          statusCode: status,
          // Error stack 第一行包含原始 message，可能夾帶 provider response 或憑證。
          stack: err?.stack?.split('\n').slice(1).join('\n'),
        },
      });
    }

    response
      .status(status)
      .send(apiErrorEnvelope(this.toApiError(exception, status)));
  }

  /** AppException 使用業務錯誤碼與訊息；其他錯誤一律依 HTTP status 對應固定內容。 */
  private toApiError(exception: unknown, status: number): ApiError {
    if (exception instanceof AppException) {
      const { details } = exception.getResponse() as { details?: unknown };
      return { code: exception.code, message: exception.message, details };
    }
    const definition =
      status >= 500
        ? AppErrors.INTERNAL_ERROR
        : ((
            FRAMEWORK_ERRORS as Partial<
              Record<number, readonly [AppErrorCode, string, HttpStatus]>
            >
          )[status] ?? AppErrors.REQUEST_FORMAT_INVALID);
    return { code: definition[0], message: definition[1] };
  }
}
