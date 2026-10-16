/** 頁碼分頁欄位：攤平在回應第一層；清單型回應以 `extends Pagination` 併入。 */
export interface Pagination {
  total: number;
  page: number;
  pageSize: number;
}

/** 頁碼分頁請求參數（皆選填，預設值由後端套用）。 */
export type PaginationParams = Partial<Pick<Pagination, 'page' | 'pageSize'>>;

/** 後端錯誤回應格式（server/src/common/http/api-error-response.ts） */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
  timestamp: string;
}
