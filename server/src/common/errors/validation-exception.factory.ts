import { HttpStatus, ValidationError } from '@nestjs/common';
import { AppErrorCode } from './app-error-code';
import { AppException } from './app.exception';

/**
 * 全域 ValidationPipe 的 exceptionFactory：把 class-validator 的錯誤
 * 統一轉成 `INVALID_REQUEST`（避免 NestJS 預設 code 變成 `Bad Request`）。
 */
export function validationExceptionFactory(
  errors: ValidationError[],
): AppException {
  const message = flattenConstraints(errors).join('; ') || '請求參數驗證失敗';
  return new AppException(
    AppErrorCode.INVALID_REQUEST,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

/** 遞迴攤平巢狀 DTO 的所有 constraint 訊息。 */
function flattenConstraints(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => {
    const own = error.constraints ? Object.values(error.constraints) : [];
    const nested = error.children?.length
      ? flattenConstraints(error.children)
      : [];
    return [...own, ...nested];
  });
}
