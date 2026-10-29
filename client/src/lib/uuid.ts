// crypto.randomUUID 只在 secure context（HTTPS 或 localhost）提供；入口網以 http 嵌入電子簽時，iframe 不是 secure context。
// crypto.getRandomValues 不受此限制，一律用它產生 UUID v4，本機與入口網內走同一條路徑。

/** 產生 UUID v4（RFC 9562） */
export function randomUUID(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
