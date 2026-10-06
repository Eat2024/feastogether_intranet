// 列表分頁（伺服器端切頁）；頁碼記在網址參數 page

/** 所有表格統一的每頁筆數 */
export const PAGE_SIZE = 10;

export function parsePage(param: string | string[] | undefined): number {
  return Math.max(1, Number.parseInt(typeof param === 'string' ? param : '1', 10) || 1);
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
