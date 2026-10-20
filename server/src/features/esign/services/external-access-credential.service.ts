import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from '#app/infrastructure/database/redis/redis.service';

/** 存取憑證自驗證成功起的有效秒數（8 小時，與內部 WebView session 相同），不因使用而延長。 */
const ACCESS_TTL_SECONDS = 8 * 60 * 60;

/**
 * 外部簽署人通過驗證碼後的存取憑證（Spec 008 research §15）。
 * cookie 值為驗證成功時隨機產生的憑證，不是邀請 token：只持有邀請連結無法自行取得存取。
 * Redis `esign:external-access:{sha256(憑證)}` 存簽署人 id，不存明碼。
 */
@Injectable()
export class ExternalAccessCredentialService {
  constructor(private readonly redis: RedisService) {}

  /** 為簽署人建立新的存取憑證，回傳只放進 cookie 的明碼 */
  async issue(signerId: number): Promise<string> {
    const credential = randomBytes(32).toString('base64url');
    await this.redis.set(
      accessKey(credential),
      String(signerId),
      ACCESS_TTL_SECONDS,
    );
    return credential;
  }

  /** 憑證對應的簽署人 id；不存在、已過期或已結束時回 null */
  async signerId(credential: string): Promise<number | null> {
    const stored = await this.redis.get(accessKey(credential));
    return stored === null ? null : Number(stored);
  }

  async revoke(credential: string): Promise<void> {
    await this.redis.del(accessKey(credential));
  }
}

function accessKey(credential: string): string {
  const digest = createHash('sha256').update(credential).digest('hex');
  return `esign:external-access:${digest}`;
}
