/**
 * 集中定義的敏感欄位清單（小寫比對、含子字串）。
 */
export const SENSITIVE_KEYS = [
  'authorization',
  'password',
  'token',
  'verification',
  // 038 OAuth：client_secret / nonce / cookie 一律遮罩
  'secret',
  'nonce',
  'cookie',
];

const MASK = '***';

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => lower.includes(s));
}

function maskEntry([key, value]: [string, unknown]): [string, unknown] {
  if (isSensitiveKey(key)) {
    return [key, value == null ? value : MASK];
  }
  return [key, maskSensitive(value)];
}

/**
 * 遞迴遮罩 body 內的敏感欄位。
 * - key 以小寫子字串比對 SENSITIVE_KEYS。
 * - null / undefined 值保留原樣（不顯示為 ***）。
 */
export function maskSensitive(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(maskSensitive);

  if (!data || typeof data !== 'object') return data; // 基本型別 / null：原樣回傳

  return Object.fromEntries(Object.entries(data).map(maskEntry));
}
