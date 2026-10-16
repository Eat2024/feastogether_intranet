import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  type KeyObject,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseVerificationSigningKey } from '#app/config/app.environment';

export interface EncryptedEsignToken {
  token: string;
  digest: string;
  ciphertext: string;
}

export interface EsignToken {
  token: string;
  digest: string;
}

/** 簽章驗證 token：版本 1 byte + kid 1 byte + signer public ID 16 bytes 為簽署內容。 */
const VERIFICATION_TOKEN_VERSION = 0x01;
const VERIFICATION_TOKEN_KID = 1;
const VERIFICATION_PAYLOAD_BYTES = 18;
const VERIFICATION_TOKEN_BYTES = VERIFICATION_PAYLOAD_BYTES + 64;

@Injectable()
export class EsignTokenService {
  private readonly key: Buffer;
  private readonly verificationPrivateKey: KeyObject;
  private readonly verificationPublicKey: KeyObject;
  private readonly verificationOrigin: string;

  constructor(config: ConfigService) {
    this.key = Buffer.from(
      config.getOrThrow<string>('ESIGN_INVITATION_ENCRYPTION_KEY_B64'),
      'base64',
    );
    if (this.key.byteLength !== 32) {
      throw new Error(
        'ESIGN_INVITATION_ENCRYPTION_KEY_B64 必須是 32 bytes 的 base64',
      );
    }
    this.verificationPrivateKey = parseVerificationSigningKey(
      config.getOrThrow<string>('ESIGN_VERIFICATION_SIGNING_KEY_B64'),
    );
    this.verificationPublicKey = createPublicKey(this.verificationPrivateKey);
    this.verificationOrigin = config.getOrThrow<string>(
      'EXTERNAL_SIGNING_ORIGIN',
    );
  }

  /** 簽章公開驗證網址；Ed25519 為確定性簽章，同一 signer 每次相同。 */
  verificationUrl(signerPublicId: string): string {
    return `${this.verificationOrigin}/verify/${this.verificationToken(signerPublicId)}`;
  }

  verificationToken(signerPublicId: string): string {
    const payload = Buffer.concat([
      Buffer.from([VERIFICATION_TOKEN_VERSION, VERIFICATION_TOKEN_KID]),
      Buffer.from(signerPublicId.replaceAll('-', ''), 'hex'),
    ]);
    if (payload.byteLength !== VERIFICATION_PAYLOAD_BYTES) {
      throw new Error('簽署人識別格式錯誤');
    }
    return Buffer.concat([
      payload,
      sign(null, payload, this.verificationPrivateKey),
    ]).toString('base64url');
  }

  /** 驗章成功回傳 signer public ID；任何格式、版本或簽章錯誤一律回 null，不區分原因。 */
  verifyVerificationToken(token: string): string | null {
    let bytes: Buffer;
    try {
      bytes = this.decodeCanonicalBase64Url(token, VERIFICATION_TOKEN_BYTES);
    } catch {
      return null;
    }
    const payload = bytes.subarray(0, VERIFICATION_PAYLOAD_BYTES);
    if (
      payload[0] !== VERIFICATION_TOKEN_VERSION ||
      payload[1] !== VERIFICATION_TOKEN_KID ||
      !verify(
        null,
        payload,
        this.verificationPublicKey,
        bytes.subarray(VERIFICATION_PAYLOAD_BYTES),
      )
    ) {
      return null;
    }
    return payload
      .subarray(2)
      .toString('hex')
      .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  }

  createInvitationToken(): EncryptedEsignToken {
    const token = this.randomToken();
    return {
      token,
      digest: this.digest(token),
      ciphertext: this.encrypt(token),
    };
  }

  createReceiptToken(): EsignToken {
    const token = this.randomToken();
    return { token, digest: this.digest(token) };
  }

  digest(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  decrypt(ciphertext: string): string {
    try {
      const [version, ivPart, tagPart, encryptedPart, extra] =
        ciphertext.split('.');
      if (
        version !== 'v1' ||
        !ivPart ||
        !tagPart ||
        !encryptedPart ||
        extra !== undefined
      ) {
        throw new Error('invalid envelope');
      }
      const iv = this.decodeCanonicalBase64Url(ivPart, 12);
      const tag = this.decodeCanonicalBase64Url(tagPart, 16);
      const encrypted = this.decodeCanonicalBase64Url(encryptedPart);
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('外部邀請憑證無法解密');
    }
  }

  private decodeCanonicalBase64Url(value: string, length?: number): Buffer {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid base64url');
    const decoded = Buffer.from(value, 'base64url');
    if (
      decoded.toString('base64url') !== value ||
      (length !== undefined && decoded.byteLength !== length)
    ) {
      throw new Error('invalid base64url');
    }
    return decoded;
  }

  private randomToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private encrypt(token: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final(),
    ]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }
}
