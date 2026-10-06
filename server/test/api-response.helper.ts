// api-response.helper.ts
// e2e 共用：把 supertest 的 `res.body`（型別是 any）收斂成全站統一的回應信封。
//
// 為什麼要有這一層：`res.body.data.items[0].xxx` 會讓 any 沿著整條斷言鏈擴散，
// 觸發一整串 no-unsafe-member-access / no-unsafe-assignment。與其逐檔 disable，
// 不如把「不安全的那一次轉型」集中在這個檔案，呼叫端一律宣告自己期望的形狀。
import type request from 'supertest';
import type { Response } from 'supertest';

/** supertest 接受的 app/server 型別（避免各 spec 用 `unknown` 再逐處轉型）。 */
export type E2eServer = Parameters<typeof request>[0];

/** 成功回應信封——見 src/framework/interceptors/response.interceptor.ts。 */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  timestamp: string;
}

/** 失敗回應信封——見 src/framework/filters/exception.handler.ts。 */
export interface ApiError {
  success: false;
  error: { code: string; message: string | string[]; details?: unknown };
  timestamp: string;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiError;

/** 分頁列表回應的共同外殼（分頁欄與 items 同層，不包 meta）。 */
export interface ApiPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * mysql2 對 INSERT 回傳的 OkPacket（只列測試會用到的欄位）。
 * `DataSource.query` 預設回 any，spec 請用 `ds.query<InsertResult>(...)` 帶入。
 */
export interface InsertResult {
  insertId: number;
  affectedRows: number;
}

/**
 * 取成功回應的 data，並宣告其形狀。
 * 呼叫端已用 `.expect(200)` 確認是成功路徑，故此處直接視為 ApiSuccess。
 */
export function apiData<T>(res: Response): T {
  return (res.body as ApiSuccess<T>).data;
}

/** 取 success 旗標——錯誤路徑最常見的斷言（`expect(apiSuccess(res)).toBe(false)`）。 */
export function apiSuccess(res: Response): boolean {
  return (res.body as ApiEnvelope<unknown>).success;
}

/** 取失敗回應的 error（斷言 code／message 用）。 */
export function apiError(res: Response): ApiError['error'] {
  return (res.body as ApiError).error;
}

/** 取整包信封——少數需要同時看 success 與 data 的地方。 */
export function apiEnvelope<T>(res: Response): ApiEnvelope<T> {
  return res.body as ApiEnvelope<T>;
}
