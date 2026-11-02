// 列表分頁工具；頁碼記在網址參數 page，可供前端切頁或後端查詢使用。

/** 所有表格統一的每頁筆數 */
export const PAGE_SIZE = 10;

export function parsePage(param: string | string[] | undefined): number {
  if (typeof param !== 'string' || !/^[1-9]\d*$/.test(param)) return 1;
  const page = Number(param);
  return Number.isSafeInteger(page) ? page : 1;
}

/** 依頁碼切出該頁資料；頁碼超出範圍時停在最後一頁 */
export function paginate<T>(items: T[], page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount);
  return {
    items: items.slice((current - 1) * pageSize, current * pageSize),
    page: current,
    pageCount,
  };
}

/** 各頁網址（給 LinkPagination 用） */
export const pageHrefs = (pageCount: number, href: (page: number) => string) =>
  Array.from({ length: pageCount }, (_, i) => href(i + 1));
