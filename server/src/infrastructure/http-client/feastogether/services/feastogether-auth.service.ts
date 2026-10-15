import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import {
  FeastogetherApiError,
  FeastogetherClient,
} from '../feastogether.client';

@Injectable()
export class FeastogetherAuthService {
  constructor(private readonly client: FeastogetherClient) {}

  /** 與 CKS 共用 staff/login；核對上游驗證的員編，token 只在此請求記憶體內使用。 */
  async authenticate(empId: string, password: string): Promise<void> {
    let data: unknown;
    try {
      data = await this.client.post(
        '/api/v1/staff/login',
        { account_id: empId, password },
        { timeoutMs: 10_000 },
      );
    } catch (error) {
      if (error instanceof FeastogetherApiError && error.status === 401) {
        throw new AppException(
          AppErrorCode.INVALID_CREDENTIALS,
          '員工編號或密碼錯誤',
          HttpStatus.UNAUTHORIZED,
        );
      }
      if (error instanceof FeastogetherApiError && error.status === 403) {
        throw new AppException(
          AppErrorCode.ACCOUNT_DISABLED,
          '帳號已停用，請聯絡資訊人員',
          HttpStatus.FORBIDDEN,
        );
      }
      throw this.unavailable();
    }
    if (
      !data ||
      typeof data !== 'object' ||
      !('token' in data) ||
      typeof data.token !== 'string' ||
      !data.token ||
      !('user' in data)
    )
      throw this.unavailable();
    const user = data.user;
    if (
      !user ||
      typeof user !== 'object' ||
      !('person_empid' in user) ||
      user.person_empid !== empId
    )
      throw this.unavailable();
  }

  private unavailable(): AppException {
    return new AppException(
      AppErrorCode.EXTERNAL_AUTH_UNAVAILABLE,
      '登入服務暫時無法使用，請稍後再試',
      HttpStatus.BAD_GATEWAY,
    );
  }
}
