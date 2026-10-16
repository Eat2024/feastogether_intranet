import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EsignTokenService } from './esign-token.service';

const serviceWithKey = (key: Buffer) =>
  new EsignTokenService(
    new ConfigService(
      {
        ESIGN_INVITATION_ENCRYPTION_KEY_B64: key.toString('base64'),
        EXTERNAL_SIGNING_ORIGIN: 'https://esign.example.internal',
      },
      { skipProcessEnv: true },
    ),
  );

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

  describe('簽章公開驗證代碼', () => {
    const service = serviceWithKey(randomBytes(32));

    it('每次產生 16 bytes 隨機值的 22 字 base64url，且通過格式檢查', () => {
      const codes = new Set(
        Array.from({ length: 50 }, () => service.createVerificationCode()),
      );
      expect(codes.size).toBe(50);
      for (const code of codes) {
        expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(Buffer.from(code, 'base64url')).toHaveLength(16);
        expect(service.isVerificationCodeFormat(code)).toBe(true);
      }
    });

    it.each([
      ['少一字', 'A'.repeat(21)],
      ['多一字', 'A'.repeat(23)],
      ['含非 base64url 字元', `${'A'.repeat(21)}=`],
      ['含路徑', `${'A'.repeat(21)}/`],
      ['空字串', ''],
    ])('%s時格式不符', (_name, code) => {
      expect(service.isVerificationCodeFormat(code)).toBe(false);
    });

    it('驗證網址為 EXTERNAL_SIGNING_ORIGIN/verify/{code}；沒有代碼時為 null', () => {
      const code = service.createVerificationCode();
      expect(service.verificationUrl(code)).toBe(
        `https://esign.example.internal/verify/${code}`,
      );
      expect(service.verificationUrl(undefined)).toBeNull();
      expect(service.verificationUrl(null)).toBeNull();
    });
  });
});
