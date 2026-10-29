import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from '#app/infrastructure/database/redis/redis.service';

/** 存取憑證自驗證成功起的有效秒數（8 小時，與內部 WebView session 相同），不因使用而延長。 */
const ACCESS_TTL_SECONDS = 8 * 60 * 60;

/**
 * 外部簽署人通過驗證碼後的存取憑證（Spec 008 research §15）。
 * cookie 值為驗證成功時隨機產生的憑證，不是邀請 token：只持有邀請連結無法自行取得存取。
 * Redis `esign:external-access:{sha256(憑證)}` 存簽署人 id 與邀請世代，不存明碼。
 */
@Injectable()
export class ExternalAccessCredentialService {
  constructor(private readonly redis: RedisService) {}

  /** 為簽署人建立新的存取憑證，回傳只放進 cookie 的明碼 */
  async issue(
    signerId: number,
    invitationGenerationSha256: string,
  ): Promise<string> {
    const credential = randomBytes(32).toString('base64url');
    await this.redis.set(
      accessKey(credential),
      JSON.stringify({ signerId, invitationGenerationSha256 }),
      ACCESS_TTL_SECONDS,
    );
    return credential;
  }

  /** 只解析憑證，不授予文件權限；呼叫端須重驗 signerType 與存取政策。舊無世代格式失效。 */
  async read(credential: string): Promise<{
    signerId: number;
    invitationGenerationSha256: string;
  } | null> {
    const stored = await this.redis.get(accessKey(credential));
    if (stored === null) return null;
    try {
      const value: unknown = JSON.parse(stored);
      if (
        !value ||
        typeof value !== 'object' ||
        !('signerId' in value) ||
        !Number.isSafeInteger(value.signerId) ||
        typeof value.signerId !== 'number' ||
        value.signerId < 1 ||
        !('invitationGenerationSha256' in value) ||
        typeof value.invitationGenerationSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.invitationGenerationSha256)
      )
        return null;
      return {
        signerId: value.signerId,
        invitationGenerationSha256: value.invitationGenerationSha256,
      };
    } catch {
      return null;
    }
  }

  async revoke(credential: string): Promise<void> {
    await this.redis.del(accessKey(credential));
  }
}

function accessKey(credential: string): string {
  const digest = createHash('sha256').update(credential).digest('hex');
  return `esign:external-access:${digest}`;
}
