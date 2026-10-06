import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { parseAesKey } from '#app/features/auth/helpers/secret-crypto';
import { isDevLoginAllowed } from '#app/framework/auth-mode';

/** 允許以 http 對接的 issuer 主機（僅本機／測試 loopback；UAT 以上一律 https）。 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** OAuth 相關環境變數名稱（單一來源；契約見 specs/038 contracts/config.md）。 */
const ENV = {
  issuer: 'OAUTH_ISSUER',
  clientId: 'OAUTH_CLIENT_ID',
  clientSecret: 'OAUTH_CLIENT_SECRET',
  redirectUri: 'OAUTH_REDIRECT_URI',
  logoutUrl: 'OAUTH_LOGOUT_URL',
  encryptionKey: 'OAUTH_TOKEN_ENCRYPTION_KEY',
} as const;

/**
 * 饗賓 OAuth／OIDC 連線設定。建構時即完整驗證：缺值或格式錯誤直接讓應用啟動失敗
 * （不留半套設定上線）。唯一例外是 DEVMOD 開發者登入開放時，本機可完全不設定
 * 統一登入（configured=false，start／callback 取設定時回 OAUTH_UNAVAILABLE 503）；
 * 只設一半仍視為設定錯誤。網路不通不在本類別範圍（Discovery 於 OauthClient 延遲進行）。
 */
@Injectable()
export class OauthConfig {
  /** 統一登入是否已設定（登入頁依此顯示統一登入按鈕）。 */
  readonly configured: boolean;

  constructor(private readonly config: ConfigService) {
    // OAUTH_REDIRECT_URI 在 .env.example 有預設值，不列入「是否有設定」的判斷。
    const anySet = Object.values(ENV)
      .filter((key) => key !== ENV.redirectUri)
      .some((key) => !!config.get<string>(key));
    this.configured = anySet || !isDevLoginAllowed(config);
    if (this.configured) this.assertComplete();
  }

  /** 受信任 issuer（exact match，Discovery 以此為根）。 */
  get issuer(): URL {
    return this.parseUrl(this.require(ENV.issuer), ENV.issuer);
  }

  /** issuer 是否為本機 loopback 的 http（僅此情況允許非 TLS）。 */
  get allowInsecure(): boolean {
    const issuer = this.issuer;
    return issuer.protocol === 'http:' && LOOPBACK_HOSTS.has(issuer.hostname);
  }

  get clientId(): string {
    return this.require(ENV.clientId);
  }

  get clientSecret(): string {
    return this.require(ENV.clientSecret);
  }

  /** 固定回呼網址（Next `/oauth/callback`）；須與上游註冊值完全相符。 */
  get redirectUri(): URL {
    const url = this.parseUrl(this.require(ENV.redirectUri), ENV.redirectUri);
    if (url.search || url.hash) {
      throw this.invalid(ENV.redirectUri, '不得含 query 或 fragment');
    }
    return url;
  }

  /** 上游自訂 `/logout`（非 OIDC end_session）；必須與 issuer 同 origin。 */
  get logoutUrl(): URL {
    const url = this.parseUrl(this.require(ENV.logoutUrl), ENV.logoutUrl);
    if (url.origin !== this.issuer.origin) {
      throw this.invalid(ENV.logoutUrl, '必須與 OAUTH_ISSUER 同 origin');
    }
    return url;
  }

  /** refresh token 存 Redis 前的 AES-256-GCM 金鑰（base64 32 bytes）。 */
  get encryptionKey(): Buffer {
    try {
      return parseAesKey(this.require(ENV.encryptionKey));
    } catch (error) {
      throw this.invalid(
        ENV.encryptionKey,
        error instanceof Error ? error.message : '格式錯誤',
      );
    }
  }

  /** 逐一取用，任何缺值／格式錯誤都在開機階段暴露。 */
  private assertComplete(): void {
    void this.issuer;
    void this.clientId;
    void this.clientSecret;
    void this.redirectUri;
    void this.logoutUrl;
    void this.encryptionKey;
    if (this.issuer.protocol !== 'https:' && !this.allowInsecure) {
      throw this.invalid(
        ENV.issuer,
        '必須為 https（僅本機 loopback 可用 http）',
      );
    }
  }

  private require(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new AppException(
        AppErrorCode.OAUTH_UNAVAILABLE,
        `OAuth 設定未就緒（缺少 ${key}）`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return value;
  }

  private parseUrl(value: string, key: string): URL {
    try {
      return new URL(value);
    } catch {
      throw this.invalid(key, '不是合法網址');
    }
  }

  /** 設定值存在但格式錯誤：訊息只帶變數名與規則，不帶實際值。 */
  private invalid(key: string, reason: string): AppException {
    return new AppException(
      AppErrorCode.OAUTH_UNAVAILABLE,
      `OAuth 設定錯誤：${key} ${reason}`,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
