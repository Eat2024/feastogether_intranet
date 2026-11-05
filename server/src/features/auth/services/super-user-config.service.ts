import { createHash, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseSuperUserPasswordHash,
  superUserCredentialFingerprint,
  verifySuperUserPassword,
  type SuperUserPasswordHash,
} from '../helpers/super-user-password';

/** Super user 專用的 server-only 設定；與 OAuth 員工帳密、client ID／secret 無關。 */
const ENV = {
  account: 'SUPER_USER_ACCOUNT',
  passwordHash: 'SUPER_USER_PASSWORD_HASH',
} as const;

/**
 * 唯一 Super user 帳密設定。建構時即驗證：缺漏或格式錯誤直接讓啟動失敗，沒有預設密碼或 fallback；
 * 錯誤訊息只含變數名，不含設定值。帳號與密碼皆原樣比對，不 trim／normalize。
 * 只提供本機設定的 fingerprint，不讀寫 DB，也不自動啟用 DB 版本。
 */
@Injectable()
export class SuperUserConfigService {
  /** 本機設定版本，供與 DB 已啟用版本比對。 */
  readonly fingerprint: string;

  private readonly accountDigest: Buffer;
  private readonly passwordHash: SuperUserPasswordHash;

  constructor(config: ConfigService) {
    const account = required(config, ENV.account);
    const encodedHash = required(config, ENV.passwordHash);
    const passwordHash = parseSuperUserPasswordHash(encodedHash);
    if (!passwordHash) {
      throw new Error(
        `環境變數 ${ENV.passwordHash} 格式錯誤，請以 pnpm -C server super-user:hash-password 產生`,
      );
    }
    this.accountDigest = digest(account);
    this.passwordHash = passwordHash;
    this.fingerprint = superUserCredentialFingerprint(account, encodedHash);
  }

  /** 先跑 KDF 再比帳號：錯帳號與錯密碼的工作量相同，不透露帳號是否存在。 */
  async verify(account: string, password: string): Promise<boolean> {
    const passwordMatches = await verifySuperUserPassword(
      password,
      this.passwordHash,
    );
    const accountMatches = timingSafeEqual(digest(account), this.accountDigest);
    return passwordMatches && accountMatches;
  }
}

function required(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  if (!value) throw new Error(`環境變數 ${key} 為必填`);
  return value;
}

/** 帳號長度不固定，先取 SHA-256 再做固定長度比較。 */
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
