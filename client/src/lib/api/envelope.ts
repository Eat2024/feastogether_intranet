// 後端統一回應信封：成功 { success: true, data }；失敗 { success: false, error: { code, message } }。
// 瀏覽器與 Next.js server 呼叫後端時共用。

/** 取出成功回應的 data；格式不符時回傳 undefined */
export function envelopeData(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return undefined;
  if (!('success' in body) || body.success !== true || !('data' in body)) return undefined;
  return body.data;
}

/** 取出失敗回應的訊息；格式不符時回傳 null */
export function envelopeError(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const { error } = body;
  if (typeof error !== 'object' || error === null || !('message' in error)) return null;
  const { message } = error;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.every((m) => typeof m === 'string')) return message.join('、');
  return null;
}
