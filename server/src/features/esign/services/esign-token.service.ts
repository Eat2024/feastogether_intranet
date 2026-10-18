import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EncryptedEsignToken {
  token: string;
  digest: string;
  ciphertext: string;
}

export interface EsignToken {
  token: string;
  digest: string;
}

/** 簽章公開驗證代碼：16 bytes 隨機值的 base64url，固定 22 字 */
const VERIFICATION_CODE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

@Injectable()
export class EsignTokenService {
  private readonly key: Buffer;
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
    this.verificationOrigin = config.getOrThrow<string>(
      'EXTERNAL_SIGNING_ORIGIN',
    );
  }

  /** 簽署成功時產生的簽章公開驗證代碼，保存在簽署紀錄 */
  createVerificationCode(): string {
    return randomBytes(16).toString('base64url');
  }

  /** 格式不符直接視為查無，不必查 DB */
  isVerificationCodeFormat(code: string): boolean {
    return VERIFICATION_CODE_PATTERN.test(code);
  }

  /** 簽章公開驗證網址；Spec 04 上線前的簽署紀錄沒有代碼，回 null */
  verificationUrl(code: string | null | undefined): string | null {
    return code ? `${this.verificationOrigin}/verify/${code}` : null;
  }

  createInvitationToken(): EncryptedEsignToken {
    const token = this.randomToken();
    return {
      token,
      digest: this.digest(token),
      ciphertext: this.encrypt(token),
    };
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
