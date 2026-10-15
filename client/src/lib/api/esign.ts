// 從 Next.js server（Server Component／Server Action）呼叫電子簽後端 API。
// 轉帶瀏覽器的 session cookie；異動請求另帶瀏覽器的 Origin，後端 OriginGuard 會比對允許清單。
import { redirect } from 'next/navigation';
import { loginHref } from '@/features/auth/navigation';
import { cookies, headers } from 'next/headers';
import { envelopeData, envelopeError } from './envelope';

// 與 next.config.ts 的 /api rewrite 目標相同
const API_BASE = process.env.API_PROXY_TARGET ?? 'http://localhost:3001';

const UNAVAILABLE_MESSAGE = '電子簽服務暫時無法使用，請稍後再試';

/** 後端回傳的錯誤；message 為可直接顯示的繁體中文訊息 */
export class EsignApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'EsignApiError';
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** 送出請求並回傳原始回應（例如 PDF）；連線失敗時拋出 EsignApiError */
export async function esignFetch(
  path: string,
  init: { method?: Method; json?: unknown } = {},
): Promise<Response> {
  const method = init.method ?? 'GET';
  const requestHeaders = new Headers();
  const cookieHeader = (await cookies()).toString();
  if (cookieHeader) requestHeaders.set('Cookie', cookieHeader);
  if (method !== 'GET') {
    const origin = (await headers()).get('origin');
    if (origin) requestHeaders.set('Origin', origin);
  }
  if (init.json !== undefined) requestHeaders.set('Content-Type', 'application/json');
  try {
    return await fetch(`${API_BASE}/api${path}`, {
      method,
      headers: requestHeaders,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      cache: 'no-store',
    });
  } catch {
    throw new EsignApiError(503, UNAVAILABLE_MESSAGE);
  }
}

/** 呼叫後端 `/api{path}`，回傳信封中的 data（型別依後端 contract）；204 無內容時回傳 undefined */
export async function esignRequest<T>(
  path: string,
  init: { method?: Method; json?: unknown; redirectOnUnauthorized?: boolean } = {},
): Promise<T> {
  const res = await esignFetch(path, init);
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (res.status === 401) {
    if (init.redirectOnUnauthorized !== false) await redirectToLogin();
    throw new EsignApiError(401, '登入已失效，請重新登入後再試一次');
  }
  if (!res.ok) throw new EsignApiError(res.status, envelopeError(body) ?? UNAVAILABLE_MESSAGE);
  const data = envelopeData(body);
  if (data === undefined) throw new EsignApiError(502, UNAVAILABLE_MESSAGE);
  return data as T;
}

/** Server Component 與 Server Action 共用；呼叫端不得吞掉 Next.js redirect。 */
export async function redirectToLogin(): Promise<never> {
  redirect(loginHref((await headers()).get('x-esign-return-to')));
}
