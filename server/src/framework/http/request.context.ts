import type { FastifyRequest } from 'fastify';

/** 接受 Fastify request 或測試用的精簡物件（只需 url / raw.url）。 */
type UrlSource = { url?: string; raw?: { url?: string } };
/** CLS key：來源 IP（由 ClsModule setup 於每請求寫入，供稽核取用）。 */
export const CLS_CLIENT_IP = 'clientIp';
/** CLS key：User-Agent（由 ClsModule setup 於每請求寫入）。 */
export const CLS_USER_AGENT = 'userAgent';

export function getRequestUrl(request: UrlSource | FastifyRequest): string {
  return request.url ?? request.raw?.url ?? '';
}

export function getRequestPath(request: UrlSource | FastifyRequest): string {
  // Fastify 比對路由前會先解碼百分比編碼；遮罩與各處路徑判斷要用同一個解碼後的路徑，
  // 否則 /api/auth/%73uper-user-entries/… 會命中路由卻繞過遮罩、Origin 與 body 不記錄的判斷。
  const path = decodePath(getRequestUrl(request).split('?')[0] || '/');
  // 路徑本身就是憑證或隱藏入口的端點，log 一律正規化，不留完整 token／入口
  return path
    .replace(
      /^(\/api)?\/(external-signature-invitations|signature-verifications)\/.*$/,
      '$1/$2/:token',
    )
    .replace(
      /^(\/api)?\/auth\/super-user-entries\/.*?(\/sessions)?$/,
      '$1/auth/super-user-entries/:entryKey$2',
    );
}

/** 編碼格式錯誤的路徑不會命中任何路由（Fastify 回 400），保留原字串供錯誤 log 使用。 */
function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
