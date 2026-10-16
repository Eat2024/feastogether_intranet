// 呼叫 NestJS 後端（server/）的 axios instance。
// 架構比照 CKS_Acceptance_System：requests（純函式）→ queries（TanStack Query hooks）→ 元件。
// baseURL 預設為同源 /api，由 next.config.ts 的 rewrites 代理到後端；只在瀏覽器端（Client Component）使用。
import axios from 'axios';

/**
 * 收到 401 時要導向的頁面。登入與 session 由外部流程建立，本專案沒有登入頁，
 * 設為 null 時不導頁，改由 ReactQueryProvider 顯示錯誤訊息（見 errorCodes 的 UNAUTHORIZED）。
 */
export const UNAUTHORIZED_REDIRECT: string | null = null;

// 在這些頁面收到 401 不導頁（例如登入頁本身密碼錯誤也會回 401，避免無限導頁）
const AUTH_PATHS: string[] = UNAUTHORIZED_REDIRECT ? [UNAUTHORIZED_REDIRECT] : [];

/**
 * axios 預設把陣列參數序列化成 `key[]=a&key[]=b`；這裡改為重複 key（`key=a&key=b`），
 * 與一般後端查詢參數的解析方式一致。陣列以外的值維持原樣，undefined／null 不送出。
 */
const serializeParams = (params: Record<string, unknown>): string => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    (Array.isArray(value) ? value : [value]).forEach((item) => {
      if (item !== undefined && item !== null) searchParams.append(key, String(item));
    });
  });
  return searchParams.toString();
};

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || '/api',
  // 帶上後端以 HttpOnly cookie 下發的 session
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  paramsSerializer: serializeParams,
});

api.interceptors.response.use(
  (response) => {
    // 後端統一包裝格式：{ success: true, data: {...} }；這裡直接攤開 data，呼叫端不必再解一層
    if (response.data?.success === true && 'data' in response.data) {
      response.data = response.data.data;
    }
    return response;
  },
  (error) => {
    // 只在瀏覽器端、且不在登入相關頁面時，才因 401 導向登入頁；403、500 等交給 Snackbar 顯示
    if (
      UNAUTHORIZED_REDIRECT &&
      error.response?.status === 401 &&
      typeof window !== 'undefined' &&
      !AUTH_PATHS.some((path) => window.location.pathname.startsWith(path))
    ) {
      // interceptor 不在元件內，無法使用 router；整頁導向也一併清掉舊的登入狀態
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = UNAUTHORIZED_REDIRECT;
    }
    // 仍 reject，讓 ReactQueryProvider 的全域 onError 或呼叫端自行處理
    return Promise.reject(error);
  },
);

export default api;
