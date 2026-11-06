import { AppErrors } from '#app/common/errors/app-errors';
import { Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
import type { OauthCallbackDto } from '#app/features/auth/dto/oauth-callback.dto';
import { OauthClient } from '#app/infrastructure/http-client/oauth/oauth.client';
import {
  toEmployeeSessionView,
  type EmployeeSessionView,
} from '../dto/session-view.dto';
import { safeLoginReturnPath } from '../helpers/login-return-path';
import { OauthIdentityService } from './oauth-identity.service';
import { OauthTransactionService } from './oauth-transaction.service';
import { SessionService } from './session.service';

export interface OauthStartResult {
  authorizationUrl: string;
  /** 寫入 HttpOnly 交易 cookie 的值（不回 JSON）。 */
  browserToken: string;
}

export interface OauthCallbackResult {
  accessToken: string;
  session: EmployeeSessionView;
  redirectTo: string;
}

/**
 * 統一登入流程協調（US1）：
 * start → 產 state／nonce、存交易、回授權網址；
 * getAccessTokenAndUserInfo → 領取交易 → 換 token（套件驗簽／nonce／issuer／aud）→ UserInfo → 配對帳號 →
 * 以本系統 session 原子替換瀏覽器目前的會話（上游 token 不持久保存）。
 * 任一步失敗不發 cookie、不撤原會話；已交換的 token 只留在記憶體，失敗即丟棄、不代呼叫上游登出。
 */
@Injectable()
export class OauthLoginService {
  constructor(
    private readonly client: OauthClient,
    private readonly transactions: OauthTransactionService,
    private readonly identities: OauthIdentityService,
    private readonly sessions: SessionService,
  ) {}

  async start(redirectTo: string | undefined): Promise<OauthStartResult> {
    const challenge = this.client.createLoginChallenge(); // 建立nonce和state
    // 先組網址（含 Discovery）這個過程會去call well-known/openid-configuration拿url。
    const authorizationUrl = await this.client.buildAuthorizationUrl(challenge);
    const browserToken = await this.transactions.start(
      challenge,
      safeLoginReturnPath(redirectTo),
    );
    return { authorizationUrl, browserToken };
  }

  async getAccessTokenAndUserInfo(
    dto: OauthCallbackDto,
    browserToken: string | null | undefined,
    currentToken: string | null,
  ): Promise<OauthCallbackResult> {
    const claimed = await this.transactions.claim(dto.state, browserToken);
    const code = this.acceptedCode(dto);

    const tokens = await this.client.exchangeCode(
      { code, state: dto.state, iss: dto.iss },
      claimed.challenge,
    );
    const info = await this.client.fetchUserInfo(
      tokens.accessToken,
      tokens.sub,
    );
    const user = await this.identities.resolve({
      sub: tokens.sub,
      userNumber: info.userNumber,
      name: info.name,
    });

    // 本系統拿到 OAuth Server 給的 AT 後會轉成自己認得的 AT
    const issued = await this.sessions.replace(currentToken, {
      kind: 'employee',
      userId: Number(user.id),
      source: 'oauth',
    });
    return {
      accessToken: issued.token,
      session: toEmployeeSessionView(user, issued.expiresAt),
      redirectTo: claimed.redirectTo,
    };
  }

  /** code／error 互斥：上游回 error 視為取消；缺 code 視為交易無效。iss 交由套件對 Discovery issuer 原字串比對。 */
  private acceptedCode(dto: OauthCallbackDto): string {
    if (dto.error !== undefined) {
      throw new AppException(...AppErrors.OAUTH_LOGIN_CANCELLED);
    }
    if (!dto.code) {
      throw new AppException(...AppErrors.OAUTH_CODE_MISSING);
    }
    return dto.code;
  }
}
