import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { FeastogetherApiError } from './feastogether.client';

/**
 * 饗賓端點（brand / department / hr / 字典）的通用 upstream→本系統錯誤對應。
 *
 * - 401/403 → UNAUTHORIZED（使用者饗賓 token 失效 / 無權）
 * - 其餘 / 連線失敗 → 502 EATOGETHER_API_SERVICE_UNAVAILABLE
 * 非 FeastogetherApiError 原樣丟出，交由既有 handler 收斂為 INTERNAL_ERROR。
 */
export function mapFeastogetherUpstreamError(error: unknown): unknown {
  if (error instanceof FeastogetherApiError) {
    if (error.status === 401 || error.status === 403) {
      return new AppException(...AppErrors.FEASTOGETHER_UNAUTHORIZED);
    }
    return new AppException(...AppErrors.FEASTOGETHER_UNAVAILABLE);
  }
  return error;
}
