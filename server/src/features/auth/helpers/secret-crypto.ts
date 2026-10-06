import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/** AES-256-GCM 固定參數；不得自創演算法或重用 IV。 */
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ENCODING = 'base64url';
const SEPARATOR = '.';

/** 版本前綴：日後換格式時可辨識舊值，避免誤解密。 */
const VERSION = 'v1';

/**
 * 解 base64 金鑰並驗長度（32 bytes）。金鑰只由環境 secret 注入，錯誤訊息不含金鑰內容。
 */
export function parseAesKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`加密金鑰長度錯誤：需為 base64 編碼的 ${KEY_BYTES} bytes`);
  }
  return key;
}

/**
 * 加密秘密字串（OAuth refresh token 存 Redis 前用）。
 * 輸出 `v1.<iv>.<ciphertext>.<tag>`（皆 base64url），每次隨機 IV。
 */
export function encryptSecret(plainText: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const cipherText = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString(ENCODING),
    cipherText.toString(ENCODING),
    tag.toString(ENCODING),
  ].join(SEPARATOR);
}

/**
 * 解密 {@link encryptSecret} 的輸出。格式錯誤、金鑰不符或密文被竄改一律回 null，
 * 由呼叫端決定語意（例如登出時視為上游未確認），不拋出含密文的錯誤。
 */
export function decryptSecret(payload: string, key: Buffer): string | null {
  const parts = payload.split(SEPARATOR);
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, ivText, cipherTextText, tagText] = parts;
  const iv = Buffer.from(ivText, ENCODING);
  const tag = Buffer.from(tagText, ENCODING);
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(cipherTextText, ENCODING)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
