import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { SESSION_SOURCE } from '#app/features/auth/auth.constants';
import type { OauthCallbackDto } from '#app/features/auth/dto/oauth-callback.dto';
import { sanitizeRedirectTo } from '#app/features/auth/helpers/redirect-to';
import { encryptSecret } from '#app/features/auth/helpers/secret-crypto';
import { OauthClient } from '#app/infrastructure/http-client/oauth/oauth.client';
import { OauthConfig } from '#app/infrastructure/http-client/oauth/oauth.config';
import { ApiAuthorizationService } from './api-authorization.service';
import { AuthSessionService } from './auth-session.service';
import { AuthService, type AuthSession } from './auth.service';
import { OauthIdentityService } from './oauth-identity.service';
import { OauthTransactionService } from './oauth-transaction.service';

export interface OauthStartResult {
  authorizationUrl: string;
  /** 寫入 HttpOnly 交易 cookie 的值（不回 JSON）。 */
  browserToken: string;
}

export interface OauthCallbackResult {
  accessToken: string;
  session: AuthSession;
  redirectTo: string;
}

/**
 * 統一登入流程協調（US1）：
 * start → 產 state／nonce、存交易、回授權網址；
 * getAccessTokenAndUserInfo → 領取交易 → 換 token（套件驗簽／nonce／issuer／aud）→ UserInfo → 配對帳號 →
 * 發本系統 session（refresh token 加密後存 Redis 供主動登出）。
 * 任一步失敗不發 cookie；已交換的 token 只留在記憶體，失敗即丟棄、不代呼叫上游登出。
 */
@Injectable()
export class OauthLoginService {
  constructor(
    private readonly config: OauthConfig,
    private readonly client: OauthClient,
    private readonly transactions: OauthTransactionService,
    private readonly identities: OauthIdentityService,
    private readonly sessions: AuthSessionService,
    private readonly authorization: ApiAuthorizationService,
    private readonly authService: AuthService,
  ) {}

  async start(redirectTo: string | undefined): Promise<OauthStartResult> {
    const challenge = this.client.createLoginChallenge(); // 建立nonce和state
    // 先組網址（含 Discovery）這個過程會去call well-known/openid-configuration拿url。
    const authorizationUrl = await this.client.buildAuthorizationUrl(challenge);
    const browserToken = await this.transactions.start(
      challenge,
      sanitizeRedirectTo(redirectTo),
    );
    return { authorizationUrl, browserToken };
  }

  async getAccessTokenAndUserInfo(
    dto: OauthCallbackDto,
    browserToken: string | null | undefined,
  ): Promise<OauthCallbackResult> {
    const claimed = await this.transactions.claim(dto.state, browserToken);
    const code = this.acceptedCode(dto);

    const tokens = await this.client.exchangeCode(
      { code, state: dto.state, iss: dto.iss },
      claimed.challenge,
    );
    if (!tokens.refreshToken) {
      throw new AppException(
        AppErrorCode.OAUTH_UNAVAILABLE,
        '統一登入未提供登出所需憑證，暫不開放此登入方式',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const info = await this.client.fetchUserInfo(
      tokens.accessToken,
      tokens.sub,
    );
    const user = await this.identities.resolve({
      sub: tokens.sub,
      employeeNumber: info.employeeNumber,
      name: info.name,
    });

    // 本系統拿到 OAuth Server 給的 AT 後會轉成自己認得的 AT
    const sessionToken = await this.sessions.issue(Number(user.id), {
      source: SESSION_SOURCE.OAUTH,
      encryptedRefreshToken: encryptSecret(
        tokens.refreshToken,
        this.config.encryptionKey,
      ),
    });
    await this.authorization.rememberUser(Number(user.id));
    const session = await this.authService.buildSession(user);
    return {
      accessToken: sessionToken,
      session,
      redirectTo: claimed.redirectTo,
    };
  }

  /** code／error 互斥：上游回 error 視為取消；缺 code 視為交易無效。iss 交由套件對 Discovery issuer 原字串比對。 */
  private acceptedCode(dto: OauthCallbackDto): string {
    if (dto.error !== undefined) {
      throw new AppException(
        AppErrorCode.OAUTH_LOGIN_CANCELLED,
        '統一登入已取消或未完成，請重新登入',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!dto.code) {
      throw new AppException(
        AppErrorCode.OAUTH_TRANSACTION_INVALID,
        '回呼缺少授權碼，請重新發起登入',
        HttpStatus.BAD_REQUEST,
      );
    }
    return dto.code;
  }
}
