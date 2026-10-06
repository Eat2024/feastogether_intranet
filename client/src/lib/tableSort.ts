// 表格排序的共用邏輯：網址參數解析、比較（中文依繁體中文排序規則）與「空值一律排最後」。

export type SortOrder = 'asc' | 'desc';
export type Sort<K extends string> = { key: K; order: SortOrder } | null;
/** 排序值；null 表示沒有值，不論升冪或降冪都排在最後；陣列依序比較 */
export type SortValue = string | number | [number, number] | null;

const collator = new Intl.Collator('zh-Hant-TW', { numeric: true });

function compare(a: NonNullable<SortValue>, b: NonNullable<SortValue>): number {
  if (Array.isArray(a) && Array.isArray(b)) return a[0] - b[0] || a[1] - b[1];
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

/** 解析 ?sort=&order=；sort 不在允許清單內時視為未排序 */
export function parseSortParams<K extends string>(
  params: { sort?: string | string[]; order?: string | string[] },
  keys: readonly K[],
): Sort<K> {
  const key = params.sort;
  if (typeof key !== 'string' || !keys.includes(key as K)) return null;
  return { key: key as K, order: params.order === 'desc' ? 'desc' : 'asc' };
}

/** 回傳排序後的新陣列 */
export function sortByValue<T>(items: T[], value: (item: T) => SortValue, order: SortOrder): T[] {
  const dir = order === 'asc' ? 1 : -1;
  return [...items].sort((ia, ib) => {
    const a = value(ia);
    const b = value(ib);
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    return compare(a, b) * dir;
  });
}

/** 點擊欄位標題後的排序：同一欄切換升／降冪，換欄從升冪開始 */
export function nextSortState<K extends string>(current: Sort<K>, key: K): { key: K; order: SortOrder } {
  return { key, order: current?.key === key && current.order === 'asc' ? 'desc' : 'asc' };
}
