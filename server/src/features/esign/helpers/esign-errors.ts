import { HttpStatus } from '@nestjs/common';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';

/** 電子簽共用錯誤：同一種錯誤的代碼、訊息與 HTTP 狀態只在這裡定義。 */

export function invalidRequest(message: string): AppException {
  return new AppException(
    AppErrorCode.INVALID_REQUEST,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

/** 不存在或無權存取一律回同一個 404，不透露資源是否存在。 */
export function resourceNotFound(message = '找不到電子簽資源'): AppException {
  return new AppException(
    AppErrorCode.ESIGN_RESOURCE_NOT_FOUND,
    message,
    HttpStatus.NOT_FOUND,
  );
}

export function stateConflict(message: string): AppException {
  return new AppException(
    AppErrorCode.ESIGN_STATE_CONFLICT,
    message,
    HttpStatus.CONFLICT,
  );
}

export function integrityFailed(): AppException {
  return new AppException(
    AppErrorCode.ESIGN_INTEGRITY_FAILED,
    '文件完整性驗證失敗',
    HttpStatus.CONFLICT,
  );
}

export function externalUnauthorized(): AppException {
  return new AppException(
    AppErrorCode.ESIGN_EXTERNAL_UNAUTHORIZED,
    '外部簽署存取已失效',
    HttpStatus.UNAUTHORIZED,
  );
}
