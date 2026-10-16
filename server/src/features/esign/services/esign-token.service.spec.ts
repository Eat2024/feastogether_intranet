import {
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
  sign,
} from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EsignTokenService } from './esign-token.service';

const pkcs8Base64 = (privateKey: KeyObject) =>
  privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const signingKey = generateKeyPairSync('ed25519').privateKey;
const signerPublicId = 'c854d925-1d70-49dc-9c81-abf18409ae42';

const serviceWith = (
  overrides: Record<string, string> = {},
  key: Buffer = randomBytes(32),
) =>
  new EsignTokenService(
    new ConfigService({
      ESIGN_INVITATION_ENCRYPTION_KEY_B64: key.toString('base64'),
      ESIGN_VERIFICATION_SIGNING_KEY_B64: pkcs8Base64(signingKey),
      EXTERNAL_SIGNING_ORIGIN: 'https://esign.example.internal',
      ...overrides,
    }),
  );
const serviceWithKey = (key: Buffer) => serviceWith({}, key);

/** 依 data-model 第 2 節自行組 token，用來產生版本或 kid 錯誤但簽章正確的樣本。 */
const forgeToken = (version: number, kid: number, privateKey = signingKey) => {
  const payload = Buffer.concat([
    Buffer.from([version, kid]),
    Buffer.from(signerPublicId.replaceAll('-', ''), 'hex'),
  ]);
  return Buffer.concat([payload, sign(null, payload, privateKey)]).toString(
    'base64url',
  );
};

describe('EsignTokenService', () => {
  it('建立 32-byte、無 padding、43 字元 base64url token 與 SHA-256', () => {
    const token = serviceWithKey(randomBytes(32)).createInvitationToken();
    expect(token.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token.token).not.toContain('=');
    expect(token.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('AES-256-GCM 可 round trip，錯誤 key 或竄改密文一律通用失敗', () => {
    const first = serviceWithKey(randomBytes(32));
    const second = serviceWithKey(randomBytes(32));
    const invitation = first.createInvitationToken();

    expect(first.decrypt(invitation.ciphertext)).toBe(invitation.token);
    expect(() => second.decrypt(invitation.ciphertext)).toThrow(
      '外部邀請憑證無法解密',
    );
    expect(() =>
      first.decrypt(`${invitation.ciphertext.slice(0, -1)}x`),
    ).toThrow('外部邀請憑證無法解密');
  });

  it('receipt 與 invitation 每次獨立產生且 receipt 不保存密文', () => {
    const service = serviceWithKey(randomBytes(32));
    const invitation = service.createInvitationToken();
    const receipt = service.createReceiptToken();

    expect(receipt.token).not.toBe(invitation.token);
    expect(receipt.digest).not.toBe(invitation.digest);
    expect(receipt).not.toHaveProperty('ciphertext');
  });

  it('拒絕非 32-byte encryption key', () => {
    expect(() => serviceWithKey(Buffer.from('short'))).toThrow('32 bytes');
  });

  describe('簽章驗證 token', () => {
    const service = serviceWith();
    const token = service.verificationToken(signerPublicId);
    // 82 bytes 的最後一個字元只有 2 個資料 bit，設定剩餘 bit 仍解得出相同 bytes
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const nonCanonical = `${token.slice(0, -1)}${alphabet[alphabet.indexOf(token.at(-1)!) | 1]}`;

    it('固定 110 字元、同一 signer 每次相同，且可驗回 signer public ID', () => {
      expect(token).toMatch(/^[A-Za-z0-9_-]{110}$/);
      expect(service.verificationToken(signerPublicId)).toBe(token);
      expect(serviceWith().verificationToken(signerPublicId)).toBe(token);
      expect(service.verifyVerificationToken(token)).toBe(signerPublicId);
      expect(token).toBe(forgeToken(0x01, 1));
    });

    it('驗證網址為 EXTERNAL_SIGNING_ORIGIN/verify/{token}，不含 signer 識別原文', () => {
      const url = service.verificationUrl(signerPublicId);
      expect(url).toBe(`https://esign.example.internal/verify/${token}`);
      expect(url).not.toContain(signerPublicId);
    });

    it('竄改任一 byte 都驗章失敗', () => {
      const bytes = Buffer.from(token, 'base64url');
      for (let index = 0; index < bytes.length; index += 1) {
        const tampered = Buffer.from(bytes);
        tampered[index] ^= 0x01;
        expect(
          service.verifyVerificationToken(tampered.toString('base64url')),
        ).toBeNull();
      }
    });

    it.each([
      ['版本不是 0x01', forgeToken(0x02, 1)],
      ['kid 不是 1', forgeToken(0x01, 2)],
      [
        '另一把私鑰簽發',
        forgeToken(0x01, 1, generateKeyPairSync('ed25519').privateKey),
      ],
      ['非 canonical base64url', nonCanonical],
      ['含非 base64url 字元', `${token.slice(0, -1)}=`],
      ['長度不足', token.slice(0, -2)],
      ['長度過長', `${token}AA`],
      ['空字串', ''],
    ])('%s時拒絕', (_name, candidate) => {
      expect(service.verifyVerificationToken(candidate)).toBeNull();
    });

    it('私鑰格式錯誤時建構失敗，錯誤訊息不含私鑰', () => {
      const badKey = pkcs8Base64(generateKeyPairSync('x25519').privateKey);
      expect(() =>
        serviceWith({ ESIGN_VERIFICATION_SIGNING_KEY_B64: badKey }),
      ).toThrow('ESIGN_VERIFICATION_SIGNING_KEY_B64');
      expect(() =>
        serviceWith({ ESIGN_VERIFICATION_SIGNING_KEY_B64: badKey }),
      ).not.toThrow(badKey);
    });
  });
});
