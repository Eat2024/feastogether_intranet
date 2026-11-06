import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Super user 密碼雜湊的固定 scrypt 參數（契約見 specs/027-super-user-access/contracts/operations.md）。
 * 參數寫死在格式裡，只接受這一組，避免透過設定注入巨大 KDF 成本。
 * 記憶體用量 128·N·r = 32 MiB，超過 Node 預設 maxmem，因此明確設 64 MiB。
 */
const SCRYPT_OPTIONS = {
  N: 32768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
} as const;
const HASH_PREFIX = `scrypt:${SCRYPT_OPTIONS.N}:${SCRYPT_OPTIONS.r}:${SCRYPT_OPTIONS.p}:`;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** fingerprint 的 domain separator；改格式時換版本字串，舊 DB 啟用版本即不再相符。 */
const FINGERPRINT_DOMAIN = 'super-user-credentials-v1';

/** 登入密碼上限（UTF-8 bytes），與登入輸入限制一致。 */
export const SUPER_USER_PASSWORD_MAX_BYTES = 1024;

/** 已解析的密碼雜湊：salt 16 bytes、derived key 64 bytes。 */
export interface SuperUserPasswordHash {
  salt: Buffer;
  key: Buffer;
}

/** 以新的隨機 salt 產生 `scrypt:32768:8:1:<salt-base64url>:<derived-key-base64url>`。 */
export async function hashSuperUserPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt);
  return `${HASH_PREFIX}${salt.toString('base64url')}:${key.toString('base64url')}`;
}

/** 解析設定中的雜湊；參數不同、段數不對或不是正規 base64url 長度一律回 undefined。 */
export function parseSuperUserPasswordHash(
  encoded: string,
): SuperUserPasswordHash | undefined {
  if (!encoded.startsWith(HASH_PREFIX)) return undefined;
  const parts = encoded.slice(HASH_PREFIX.length).split(':');
  if (parts.length !== 2) return undefined;
  const salt = decodeExact(parts[0], SALT_BYTES);
  const key = decodeExact(parts[1], KEY_BYTES);
  return salt && key ? { salt, key } : undefined;
}

/** 非同步 scrypt 後以固定長度 timingSafeEqual 比較；密碼原樣使用，不 trim／normalize。 */
export async function verifySuperUserPassword(
  password: string,
  hash: SuperUserPasswordHash,
): Promise<boolean> {
  return timingSafeEqual(await derive(password, hash.salt), hash.key);
}

/**
 * 帳密設定版本：SHA-256(domain + NUL + UTF-8 JSON.stringify([account, encodedHash]))，hex 64 字元。
 * 同一 hash 穩定；同密碼重新產生（新 salt）即為新版本。不含可還原帳密的資訊。
 */
export function superUserCredentialFingerprint(
  account: string,
  encodedHash: string,
): string {
  return createHash('sha256')
    .update(
      `${FINGERPRINT_DOMAIN}\u0000${JSON.stringify([account, encodedHash])}`,
    )
    .digest('hex');
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, SCRYPT_OPTIONS, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Node 的 base64url 解碼會略過非法字元，以「長度正確且重新編碼相同」確認是正規編碼。 */
function decodeExact(value: string, bytes: number): Buffer | undefined {
  const decoded = Buffer.from(value, 'base64url');
  return decoded.length === bytes && decoded.toString('base64url') === value
    ? decoded
    : undefined;
}
