import { Decimal as DecimalBase } from 'decimal.js';

// ROUND_HALF_UP（四捨五入，逢 .5 進位）——比照財務慣例；為 decimal.js 預設值，明列以防他處改動全域。
export const Decimal = DecimalBase.clone({
  rounding: DecimalBase.ROUND_HALF_UP,
});
export type Decimal = InstanceType<typeof Decimal>;

/**
 * 將 DB decimal 字串/數值正規化為固定小數位字串（null/undefined/空 → 0）。
 * 全程走 decimal.js，不繞經 JS float，精度與進位皆正確。
 */
export function toFixedStr(
  value: string | number | null | undefined,
  scale: number,
): string {
  if (value === null || value === undefined || value === '') {
    return new Decimal(0).toFixed(scale);
  }
  return new Decimal(value).toFixed(scale);
}
