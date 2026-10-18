import { AppErrors } from '#app/common/errors/app-errors';
import { Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
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
        throw new AppException(...AppErrors.INVALID_CREDENTIALS);
      }
      if (error instanceof FeastogetherApiError && error.status === 403) {
        throw new AppException(...AppErrors.ACCOUNT_DISABLED_CONTACT_IT);
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
    return new AppException(...AppErrors.LOGIN_UNAVAILABLE);
  }
}
