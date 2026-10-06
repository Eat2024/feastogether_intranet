// query-param.helper.ts
// 查詢參數的正規化（DTO 的 @Transform 用）。

/**
 * 多值參數 → 去空白、去空字串的 `string[]`。
 *
 * 同時吃三種來源形狀，因為前端與框架各自會產出不同的：
 *   - 重複 query key：`?a=1&a=2` → `['1', '2']`
 *   - 逗號分隔字串：`?a=1,2` → `'1,2'`
 *   - 單值：`?a=1` → `'1'`
 *
 * **一律回陣列、不回 `undefined`**——呼叫端對「空」的期待不同，交給呼叫端決定：
 * 必填欄位要拿到 `[]` 才能讓 `@ArrayNotEmpty` 產生正確的錯誤訊息（回 `undefined`
 * 會先被 `@IsArray` 擋下，使用者看到的是泛用訊息）；選填的篩選維度則想要
 * `undefined` 代表「不加這個條件」，自行以 `items.length > 0 ? items : undefined` 收斂。
 *
 * 非字串值以 `String()` 轉換而非丟棄：本 helper 也用於 JSON body（如
 * `POST /orders/build` 的篩選維度），那裡 `[123]` 是合理輸入，丟棄會讓篩選條件
 * 無聲消失。`null` / `undefined` 則明確剔除，否則會變成 `'null'` / `'undefined'` 這種假值。
 */
export function toStringArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value])
    .filter((item) => item !== undefined && item !== null)
    .flatMap((item: unknown) =>
      typeof item === 'string' ? item.split(',') : [String(item)],
    )
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
