import { randomBytes } from 'crypto';
import { decryptSecret, encryptSecret, parseAesKey } from './secret-crypto';

const key = randomBytes(32);

describe('secret-crypto', () => {
  it('加密後可用同一把金鑰解回原文，且每次密文不同（隨機 IV）', () => {
    const a = encryptSecret('refresh-token-synthetic', key);
    const b = encryptSecret('refresh-token-synthetic', key);

    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe('refresh-token-synthetic');
    expect(decryptSecret(b, key)).toBe('refresh-token-synthetic');
  });

  it('金鑰不同 → 解密回 null，不拋錯', () => {
    const payload = encryptSecret('secret', key);

    expect(decryptSecret(payload, randomBytes(32))).toBeNull();
  });

  it('密文被竄改 → 驗證失敗回 null', () => {
    const payload = encryptSecret('secret-long-enough-to-tamper', key);
    const [v, iv, ct, tag] = payload.split('.');
    const flipped = ct.startsWith('A') ? `B${ct.slice(1)}` : `A${ct.slice(1)}`;
    const tampered = [v, iv, flipped, tag].join('.');

    expect(decryptSecret(tampered, key)).toBeNull();
  });

  it.each([['not-a-payload'], ['v0.a.b.c'], ['v1.a.b'], ['']])(
    '格式錯誤 %s → null',
    (payload) => {
      expect(decryptSecret(payload, key)).toBeNull();
    },
  );

  it('parseAesKey 拒絕長度不是 32 bytes 的金鑰', () => {
    expect(() => parseAesKey(randomBytes(16).toString('base64'))).toThrow(
      '金鑰長度錯誤',
    );
    expect(parseAesKey(key.toString('base64')).equals(key)).toBe(true);
  });
});
