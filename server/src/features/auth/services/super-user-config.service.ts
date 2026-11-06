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

/** 未設定帳密時，REPL 寫入 DB 帳密版本的操作（initialize／activateCredentials）丟出的訊息。 */
export const SUPER_USER_NOT_CONFIGURED = `未設定 ${ENV.account}／${ENV.passwordHash}，維護登入停用；設定後重新啟動 REPL 再執行`;

/**
 * 唯一 Super user 帳密設定。任一變數未設定時維護登入停用（沒有人能以 Super user 登入），其他功能照常啟動，
 * 例如先填帳號、再以 REPL hashPassword() 產生 hash。hash 有填但格式錯誤時讓啟動失敗；沒有預設密碼或 fallback。
 * 錯誤訊息只含變數名，不含設定值。帳號與密碼皆原樣比對，不 trim／normalize。
 * 只提供本機設定的 fingerprint，不讀寫 DB，也不自動啟用 DB 版本。
 */
@Injectable()
export class SuperUserConfigService {
  /** 本機設定版本，供與 DB 已啟用版本比對；未設定時為 null，與 DB 任何版本都不相符。 */
  readonly fingerprint: string | null = null;

  private readonly credentials: {
    accountDigest: Buffer;
    passwordHash: SuperUserPasswordHash;
  } | null = null;

  constructor(config: ConfigService) {
    const account = config.get<string>(ENV.account);
    const encodedHash = config.get<string>(ENV.passwordHash);
    if (!account || !encodedHash) return;
    const passwordHash = parseSuperUserPasswordHash(encodedHash);
    if (!passwordHash) {
      throw new Error(
        `環境變數 ${ENV.passwordHash} 格式錯誤，請以 pnpm -C server super-user:hash-password 產生`,
      );
    }
    this.credentials = { accountDigest: digest(account), passwordHash };
    this.fingerprint = superUserCredentialFingerprint(account, encodedHash);
  }

  /** 先跑 KDF 再比帳號：錯帳號與錯密碼的工作量相同，不透露帳號是否存在。未設定時一律不通過。 */
  async verify(account: string, password: string): Promise<boolean> {
    if (!this.credentials) return false;
    const passwordMatches = await verifySuperUserPassword(
      password,
      this.credentials.passwordHash,
    );
    const accountMatches = timingSafeEqual(
      digest(account),
      this.credentials.accountDigest,
    );
    return passwordMatches && accountMatches;
  }
}

/** 帳號長度不固定，先取 SHA-256 再做固定長度比較。 */
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
