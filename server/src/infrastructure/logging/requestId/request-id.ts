import { randomUUID } from 'crypto';
import { isUUID } from 'class-validator';

export const CLS_REQUEST_ID = 'requestId';
export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * 接受任何合法 UUID（v1–v8 / nil / max，RFC 4122/9562）。
 * 驗證委派 class-validator 的 isUUID，不自寫 regex。
 */
export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && isUUID(value, 'all');
}

/**
 * 由傳入的 `x-request-id` header 值解析出可用的 request id。
 * - 合法 UUID（單一值）→ normalize 為小寫沿用
 * - 空字串 / 非 UUID / 過長 / 含控制字元 / 多值（陣列）→ 視為未提供，回傳 null
 */
export function resolveRequestId(
  headerValue: string | string[] | undefined,
): string | null {
  if (typeof headerValue !== 'string') return null; // undefined 或多值陣列
  if (!isValidUuid(headerValue)) return null;
  return headerValue.toLowerCase();
}

/**
 * Fastify `genReqId` 用的產生器：沿用合法的 `x-request-id`，否則產生新的小寫 UUID。
 * main.ts 與 e2e 測試共用，避免邏輯 drift。
 */
export function generateRequestId(headers: {
  [k: string]: string | string[] | undefined;
}): string {
  return resolveRequestId(headers['x-request-id']) ?? randomUUID();
}

type HeaderBag = { [k: string]: string | string[] | undefined };

/**
 * nestjs-cls `idGenerator`：由 raw request headers 算出 request id。
 * 注意：Nest middleware 在 Fastify 下拿到的是 raw IncomingMessage（無 Fastify 的 req.id），
 * 故以 headers 為來源，不依賴 req.id。
 */
export function requestIdFromHeaders(req: { headers: HeaderBag }): string {
  return generateRequestId(req.headers);
}

/**
 * ClsModule middleware `setup`（早於 Guard）：把 CLS id 鏡射到 `requestId` key，
 * 並回寫 X-Request-Id response header（涵蓋所有回應）。
 * res 在 Fastify middleware 為 raw ServerResponse（用 setHeader）；同時相容 FastifyReply.header。
 * FrameworkModule 與 e2e 共用，避免 drift。
 */
export function bindRequestIdToResponse(
  cls: { getId: () => string; set: (key: string, value: unknown) => void },
  res: {
    setHeader?: (key: string, value: string) => void;
    header?: (key: string, value: string) => void;
  },
): void {
  const id = cls.getId();
  cls.set(CLS_REQUEST_ID, id);
  if (typeof res.setHeader === 'function') {
    res.setHeader(REQUEST_ID_HEADER, id);
  } else if (typeof res.header === 'function') {
    res.header(REQUEST_ID_HEADER, id);
  }
}
