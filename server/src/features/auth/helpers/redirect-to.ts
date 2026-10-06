/** 登入返回位置最長字元數（超過視為不合法）。 */
const REDIRECT_TO_MAX_LENGTH = 2048;

/** 預設返回位置（無合法 redirectTo 時進首頁）。 */
export const DEFAULT_REDIRECT_TO = '/';

/** 不允許作為返回位置的站內路徑（會形成登入循環）。 */
const LOOP_PATH_PREFIXES = ['/login', '/oauth/callback', '/forgetPassword'];

/** ASCII 控制字元（含 DEL）。 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/**
 * 登入返回位置只允許站內相對路徑（FR-011）：
 * - 必須以單一 `/` 開頭；`//`、`/\` 會被瀏覽器當成 protocol-relative 站外網址，一律拒絕。
 * - 不含控制字元、不超過長度上限、不是登入／回呼頁本身。
 * 不合法者一律退回預設首頁，不拋錯（返回位置不是使用者要修的輸入）。
 */
export function sanitizeRedirectTo(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0)
    return DEFAULT_REDIRECT_TO;
  if (input.length > REDIRECT_TO_MAX_LENGTH) return DEFAULT_REDIRECT_TO;
  if (!input.startsWith('/')) return DEFAULT_REDIRECT_TO;
  if (input.startsWith('//') || input.startsWith('/\\'))
    return DEFAULT_REDIRECT_TO;
  if (CONTROL_CHARS.test(input)) return DEFAULT_REDIRECT_TO;
  if (LOOP_PATH_PREFIXES.some((prefix) => input.startsWith(prefix))) {
    return DEFAULT_REDIRECT_TO;
  }
  return input;
}
