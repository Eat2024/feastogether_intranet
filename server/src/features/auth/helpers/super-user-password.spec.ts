import {
  hashSuperUserPassword,
  parseSuperUserPasswordHash,
  superUserCredentialFingerprint,
  verifySuperUserPassword,
} from './super-user-password';

// 合成 fixture：以 node:crypto scryptSync(N=32768、r=8、p=1、64 bytes) 對 'synthetic-password'
// 與 salt 'synthetic-salt-1'（16 bytes）預先算出；不是任何環境的真實帳密。
const PASSWORD = 'synthetic-password';
const SALT = 'c3ludGhldGljLXNhbHQtMQ';
const KEY =
  'e5MOmhbfpAQjmIvtnCNojhdOzHTNwqq8KUxp41MZx5oPypHsc1x957o8gY2K45Ak2LJkLw5AbLscDIDUVrl3vw';
const HASH = `scrypt:32768:8:1:${SALT}:${KEY}`;

const parse = (encoded: string) => {
  const parsed = parseSuperUserPasswordHash(encoded);
  if (!parsed) throw new Error('fixture 應可解析');
  return parsed;
};

describe('super-user-password', () => {
  it('依固定 scrypt 參數驗證預先算出的 hash：正確密碼通過、錯誤密碼不通過', async () => {
    await expect(verifySuperUserPassword(PASSWORD, parse(HASH))).resolves.toBe(
      true,
    );
    await expect(
      verifySuperUserPassword('synthetic-passworD', parse(HASH)),
    ).resolves.toBe(false);
  });

  it.each([
    ['前後空白', ` ${PASSWORD} `],
    ['結尾換行', `${PASSWORD}\n`],
  ])('密碼不 trim：%s 不通過', async (_label, password) => {
    await expect(verifySuperUserPassword(password, parse(HASH))).resolves.toBe(
      false,
    );
  });

  it('密碼不做 Unicode normalize：NFC 產生的 hash 不接受 NFD 輸入', async () => {
    const nfc = 'café-synthetic';
    const hash = parse(await hashSuperUserPassword(nfc));

    await expect(verifySuperUserPassword(nfc, hash)).resolves.toBe(true);
    await expect(
      verifySuperUserPassword(nfc.normalize('NFD'), hash),
    ).resolves.toBe(false);
  });

  it('新產生的 hash 為固定格式且可驗證；同一密碼每次使用新 salt', async () => {
    const first = await hashSuperUserPassword(PASSWORD);
    const second = await hashSuperUserPassword(PASSWORD);

    expect(first).toMatch(
      /^scrypt:32768:8:1:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{86}$/,
    );
    expect(second).not.toBe(first);
    await expect(verifySuperUserPassword(PASSWORD, parse(first))).resolves.toBe(
      true,
    );
  });

  it.each([
    ['空字串', ''],
    ['前後空白', ` ${HASH} `],
    ['其他演算法', `argon2:32768:8:1:${SALT}:${KEY}`],
    ['N 不同', `scrypt:16384:8:1:${SALT}:${KEY}`],
    ['r 不同', `scrypt:32768:16:1:${SALT}:${KEY}`],
    ['p 不同', `scrypt:32768:8:2:${SALT}:${KEY}`],
    ['缺 derived key', `scrypt:32768:8:1:${SALT}`],
    ['多一段', `${HASH}:extra`],
    ['salt 15 bytes', `scrypt:32768:8:1:${SALT.slice(0, 20)}:${KEY}`],
    ['salt 帶 padding', `scrypt:32768:8:1:${SALT}==:${KEY}`],
    // 與 SALT 解出相同 bytes，但尾端未用位元非 0，不是正規 base64url
    ['salt 非正規編碼', `scrypt:32768:8:1:c3ludGhldGljLXNhbHQtMR:${KEY}`],
    ['salt 用標準 base64 字元', `scrypt:32768:8:1:+${SALT.slice(1)}:${KEY}`],
    ['derived key 32 bytes', `scrypt:32768:8:1:${SALT}:${KEY.slice(0, 43)}`],
  ])('只接受固定參數與正規長度：%s 解析失敗', (_label, encoded) => {
    expect(parseSuperUserPasswordHash(encoded)).toBeUndefined();
  });

  it('fingerprint 依契約 domain separation 與 JSON 序列化計算，同一設定穩定', () => {
    // SHA-256("super-user-credentials-v1" + NUL + JSON.stringify([account, hash]))，DB 啟用版本依此比對
    expect(superUserCredentialFingerprint('synthetic-ops', HASH)).toBe(
      '8758fe79025759211dc92fc324ffb4e37529b7146893f5fe2f5e17484ee71bfc',
    );
  });

  it('fingerprint 帳號不同或改用新 salt 的 hash 即視為新版本', async () => {
    const original = superUserCredentialFingerprint('synthetic-ops', HASH);
    const rehashed = await hashSuperUserPassword(PASSWORD);

    expect(superUserCredentialFingerprint('synthetic-ops ', HASH)).not.toBe(
      original,
    );
    expect(superUserCredentialFingerprint('synthetic-ops', rehashed)).not.toBe(
      original,
    );
  });
});
