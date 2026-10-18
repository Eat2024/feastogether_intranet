import { AppErrors } from '#app/common/errors/app-errors';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '#app/common/errors/app.exception';

/**
 * 饗賓 API 連線設定（base URL + X-API-KEY）。
 *
 * 採延遲驗證（取用時才檢查），讓未設定饗賓憑證的本地開發（只走超級使用者）
 * 仍可開機；真正打饗賓而缺值時才丟 EXTERNAL_AUTH_UNAVAILABLE(502)，語意一致。
 * 憑證一律走 env、不入庫（見 [[hxbin-api-key-in-env]]）。
 */
@Injectable()
export class FeastogetherConfig {
  constructor(private readonly config: ConfigService) {}

  get baseUrl(): string {
    return this.require('FEASTOGETHER_BASE_URL');
  }

  get apiKey(): string {
    return this.require('FEASTOGETHER_API_KEY');
  }

  private require(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new AppException(...AppErrors.FEASTOGETHER_CONFIG_MISSING);
    }
    return value;
  }
}
