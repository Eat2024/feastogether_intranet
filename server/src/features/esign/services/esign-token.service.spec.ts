import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EsignTokenService } from './esign-token.service';

const serviceWithKey = (key: Buffer) =>
  new EsignTokenService(
    new ConfigService(
      { ESIGN_INVITATION_ENCRYPTION_KEY_B64: key.toString('base64') },
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
});
