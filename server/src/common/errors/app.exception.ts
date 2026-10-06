import { HttpException, HttpStatus } from '@nestjs/common';
import { AppErrorCode } from './app-error-code';

/**
 * 業務錯誤統一拋出點。
 * 用法：`throw new AppException(AppErrorCode.NOT_FOUND, '資源不存在', HttpStatus.NOT_FOUND)`
 */
export class AppException extends HttpException {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(
      details === undefined
        ? { error: code, message }
        : { error: code, message, details: { ...details } },
      status,
    );
  }
}
