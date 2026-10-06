import { tz } from '@date-fns/tz';
import { format, isValid, parseISO, toDate } from 'date-fns';

type DateTimeInput = Date | string | number;

/**
 * 營運時區的 IANA 識別字串——**全專案唯一出處**。
 *
 * 需要字串形式的場合（例如 cron 求值時區）直接用它；
 * 需要 date-fns 時區物件的場合用下方的 `TAIPEI_TIME_ZONE`。
 * 營運時區固定為台北，不隨部署環境（server／container 時區）改變。
 */
export const TAIPEI_TIME_ZONE_ID = 'Asia/Taipei';

const UTC_TIME_ZONE = tz('UTC');
const TAIPEI_TIME_ZONE = tz(TAIPEI_TIME_ZONE_ID);
/** 寫入 DB 的 datetime 字面格式（無時區標記，故必須搭配明確的 UTC 輸出）。 */
const UTC_DATETIME_FORMAT = 'yyyy-MM-dd HH:mm:ss.SSS';
const DATABASE_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/;

function parseDateTime(value: DateTimeInput): Date {
  const date =
    typeof value === 'string'
      ? parseISO(
          DATABASE_DATETIME_PATTERN.test(value)
            ? `${value.replace(' ', 'T')}Z`
            : value,
        )
      : toDate(value);
  if (!isValid(date)) {
    throw new RangeError('無效的日期時間');
  }
  return date;
}

/** 轉為 DB 寫入用的 UTC datetime 字面值。 */
export function toUtcDateTime(value: DateTimeInput): string {
  return format(parseDateTime(value), UTC_DATETIME_FORMAT, {
    in: UTC_TIME_ZONE,
  });
}

/**
 * 以台北時區格式化任意時間點。
 *
 * 取「今天」是最常見的用法，已包成 {@link todayInTaipei}——請優先用它，
 * 讓「哪裡依賴系統當下時間」在全專案 grep 得出來。
 */
export function formatInTaipei(value: DateTimeInput, pattern: string): string {
  return format(parseDateTime(value), pattern, { in: TAIPEI_TIME_ZONE });
}

/**
 * 台北的**今日**日曆日，預設 `YYYY-MM-DD`。
 *
 * 全專案取「今天」的唯一入口——業務用的 `new Date()` 只出現在這裡一次。
 * 台北早上 8 點前（例如 07:00 ＝ UTC 前一日 23:00），在 UTC container 上用本地
 * getter 取日曆日會拿到昨天；一律走台北時區。
 *
 * 想格式化「今日以外」的某個時間點請用 {@link formatInTaipei}。
 */
export function todayInTaipei(pattern = 'yyyy-MM-dd'): string {
  return formatInTaipei(new Date(), pattern);
}

/**
 * DB 的 `date` 欄位 → `YYYY-MM-DD`（無值回 null）。
 *
 * 兩種輸入都要收：mysql2 未設 `dateStrings`（見 `mysql.options.ts` 的 `extra`），
 * TypeORM 的 `date` 欄位取回 `Date` 物件，raw query 的同一欄則可能是字串。
 * `Date` 一律走 `toISOString()`（UTC getter）——driver timezone 為 `+00:00`，
 * DATE 欄回的是 UTC 午夜，改用本地 getter 於 UTC 以西的時區會差一天。
 *
 * ⚠️ **這是格式收斂，不是時區轉換。** `toDateStr(new Date())` 給的是 UTC 的今天，
 * 不是台北的今天——要台北日曆日請用 {@link todayInTaipei}／{@link formatInTaipei}。
 */
export function toDateStr(value: string | Date): string;
export function toDateStr(
  value: string | Date | null | undefined,
): string | null;
export function toDateStr(
  value: string | Date | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}
