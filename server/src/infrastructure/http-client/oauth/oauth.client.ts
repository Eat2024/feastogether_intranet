import { HttpStatus, Injectable } from '@nestjs/common';
import * as oidc from 'openid-client';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { OAUTH_HTTP_TIMEOUT_SECONDS } from '#app/features/auth/auth.constants';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { getErrorType } from '#app/infrastructure/logging/logHelper/error-type';
import { OauthConfig } from './oauth.config';

/** 固定請求 scope：只取登入所需身分，不請求 staff 業務能力或 offline_access（R5）。 */
const SCOPE = 'openid profile email';

/** 上游 `/logout` 成功時 HTTP 狀態與 body 的 status 值（003 契約）。 */
const LOGOUT_SUCCESS_HTTP_STATUS = 200;
const LOGOUT_SUCCESS_STATUS = 'logged_out';

/** 一次登入交易的秘密：state 綁定回呼、nonce 綁定 ID token。 */
export interface OauthLoginChallenge {
  state: string;
  nonce: string;
}

/** 回呼帶回的白名單參數（只接受 code／state／iss，其餘一律丟棄）。 */
export interface OauthCallbackParams {
  code: string;
  state: string;
  iss?: string;
}

/** 授權碼交換後保留的最小結果；access／ID token 驗完身分即丟，不持久保存。 */
export interface OauthTokens {
  sub: string;
  accessToken: string;
  refreshToken: string | null;
}

/** UserInfo 中本系統需要的欄位（sub 與員編皆為不透明字串，不轉數字）。 */
export interface OauthUserInfo {
  sub: string;
  employeeNumber: string | null;
  name: string | null;
  email: string | null;
}

/**
 * 饗賓 OAuth／OIDC 傳輸層：唯一接觸 openid-client 與上游 endpoint 的地方。
 *
 * - Discovery 以固定 issuer 進行、程序內快取＋single-flight；失敗不快取，下次重試。
 * - 機密 Client 採 client_secret_post，不使用 PKCE（R5）。
 * - ID token 簽章、issuer／audience／exp／nonce 與 UserInfo sub 一致性由套件驗證；
 *   本層只把失敗對應成穩定錯誤碼，不記錄 token／code／secret。
 * - 每個 HTTP 請求逾時 5 秒、不自動重送授權碼與 logout。
 */
@Injectable()
export class OauthClient {
  private configuration?: Promise<oidc.Configuration>;

  constructor(
    private readonly config: OauthConfig,
    private readonly logger: AppLoggerService,
  ) {}

  /** 產生一次登入交易的 state／nonce（皆由套件的安全亂數產生）。 */
  createLoginChallenge(): OauthLoginChallenge {
    return {
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
    };
  }

  /** 依受信任 Discovery 與固定 client／redirect／scope 組授權網址。 */
  async buildAuthorizationUrl(challenge: OauthLoginChallenge): Promise<string> {
    const configuration = await this.getConfiguration();
    return oidc
      .buildAuthorizationUrl(configuration, {
        redirect_uri: this.config.redirectUri.href,
        scope: SCOPE,
        state: challenge.state,
        nonce: challenge.nonce,
        response_mode: 'query',
      })
      .toString();
  }

  /**
   * 以白名單參數重建回呼網址交套件驗證並換 token；驗 nonce／iss／ID token 簽章與 claims。
   * state 的真正綁定在 OauthTransactionService 的 Redis key（state＋瀏覽器）；此處的
   * expectedState 只是套件要求的形式參數，與回呼 state 同值。任何失敗 → OAUTH_RESPONSE_INVALID(401)。
   */
  async exchangeCode(
    params: OauthCallbackParams,
    challenge: OauthLoginChallenge,
  ): Promise<OauthTokens> {
    const configuration = await this.getConfiguration();
    const currentUrl = new URL(this.config.redirectUri.href);
    currentUrl.searchParams.set('code', params.code);
    currentUrl.searchParams.set('state', params.state);
    if (params.iss) currentUrl.searchParams.set('iss', params.iss);
    try {
      const tokens = await oidc.authorizationCodeGrant(
        configuration,
        currentUrl,
        {
          expectedState: challenge.state,
          expectedNonce: challenge.nonce,
          idTokenExpected: true,
        },
      );
      const sub = tokens.claims()?.sub;
      if (!sub) throw new Error('ID token 缺少 sub');
      return {
        sub,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
      };
    } catch (error) {
      throw this.responseInvalid('oauth.code_exchange_failed', error);
    }
  }

  /** 以 access token 查 UserInfo，並由套件核對 sub 與已驗證 ID token 相同。 */
  async fetchUserInfo(
    accessToken: string,
    expectedSub: string,
  ): Promise<OauthUserInfo> {
    const configuration = await this.getConfiguration();
    try {
      const info = await oidc.fetchUserInfo(
        configuration,
        accessToken,
        expectedSub,
      );
      return {
        sub: info.sub,
        employeeNumber: stringOrNull(info.employee_number),
        name: stringOrNull(info.name),
        email: stringOrNull(info.email),
      };
    } catch (error) {
      throw this.responseInvalid('oauth.userinfo_failed', error);
    }
  }

  /**
   * 呼叫上游自訂 `/logout`（form：client_id／client_secret／refresh_token）。
   * 只有 HTTP 200 且 body.status=logged_out 才算確認；逾時、非 200、body 不符皆回 false，
   * 不重試、不跟隨 redirect、不改用 revoke／end_session（R7）。
   */
  async logout(refreshToken: string): Promise<boolean> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
    });
    try {
      const response = await fetch(this.config.logoutUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_SECONDS * 1000),
      });
      if (response.status !== LOGOUT_SUCCESS_HTTP_STATUS) {
        this.warn('oauth.logout_unconfirmed', { status: response.status });
        return false;
      }
      const payload = (await response.json()) as { status?: unknown };
      return payload?.status === LOGOUT_SUCCESS_STATUS;
    } catch (error) {
      this.warn('oauth.logout_unconfirmed', { errorType: getErrorType(error) });
      return false;
    }
  }

  /** call well-known/openid-configuration */
  private getConfiguration(): Promise<oidc.Configuration> {
    if (!this.configuration) {
      this.configuration = this.discover().catch((error: unknown) => {
        this.configuration = undefined;
        throw error;
      });
    }
    return this.configuration;
  }

  private async discover(): Promise<oidc.Configuration> {
    const execute: Array<(configuration: oidc.Configuration) => void> = [
      oidc.enableNonRepudiationChecks,
    ];
    if (this.config.allowInsecure) execute.push(oidc.allowInsecureRequests);
    try {
      return await oidc.discovery(
        this.config.issuer,
        this.config.clientId,
        undefined,
        oidc.ClientSecretPost(this.config.clientSecret),
        { execute, timeout: OAUTH_HTTP_TIMEOUT_SECONDS },
      );
    } catch (error) {
      this.warn('oauth.discovery_failed', { errorType: getErrorType(error) });
      throw new AppException(
        AppErrorCode.OAUTH_UNAVAILABLE,
        '統一登入服務暫時無法使用',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /** 上游回應驗證失敗：只記錯誤型別與（若有）OAuth error code，不記 token／code。 */
  private responseInvalid(event: string, error: unknown): AppException {
    if (error instanceof AppException) return error;
    this.warn(event, {
      errorType: getErrorType(error),
      oauthError:
        error instanceof oidc.ResponseBodyError ? error.error : undefined,
    });
    return new AppException(
      AppErrorCode.OAUTH_RESPONSE_INVALID,
      '統一登入身分驗證失敗，請重新登入',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private warn(event: string, metadata: Record<string, unknown>): void {
    this.logger.warn({ context: OauthClient.name, event, metadata });
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
