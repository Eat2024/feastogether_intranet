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
  return getRequestUrl(request).split('?')[0] || '/';
}
