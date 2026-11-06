import { timingSafeEqual } from 'node:crypto';

/** 入口為 32 random bytes 的 base64url（43 字元）；其他格式直接視為無效，不查表比對。 */
const ENTRY_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 請求帶的入口是否等於 DB 目前入口；格式相符後以固定長度 timingSafeEqual 比較。 */
export function isCurrentSuperUserEntry(
  candidate: string,
  current: string,
): boolean {
  return (
    ENTRY_KEY_PATTERN.test(candidate) &&
    timingSafeEqual(Buffer.from(candidate), Buffer.from(current))
  );
}
