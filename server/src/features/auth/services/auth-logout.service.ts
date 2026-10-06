import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import {
  UPSTREAM_LOGOUT,
  type UpstreamLogoutStatus,
} from '#app/features/auth/auth.constants';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import {
  AuthSessionService,
  type AuthSessionRecord,
} from './auth-session.service';
import { AuthSessionVerifierService } from './auth-session-verifier.service';

/** 登出回應（contracts/http.md §6）。 */
export interface LogoutResult {
  localLogout: 'completed';
  upstreamLogout: UpstreamLogoutStatus;
  message?: string;
}

/**
 * 主動登出：原子撤銷本地 session。OAuth 模組目前未註冊，因此不呼叫上游登出，
 * 成功撤銷後回 not_applicable。
 * - 本地撤銷失敗 → 503 AUTH_SESSION_UNAVAILABLE（不得只清 cookie 就宣稱憑證失效）。
 * - 無有效 session（過期、重複登出、無 cookie）→ not_attempted。
 */
@Injectable()
export class AuthLogoutService {
  constructor(
    private readonly verifier: AuthSessionVerifierService,
    private readonly sessions: AuthSessionService,
    private readonly logger: AppLoggerService,
  ) {}

  async logout(cookieToken: string | null): Promise<LogoutResult> {
    const identity = cookieToken
      ? await this.verifier.verifyToken(cookieToken)
      : null;
    if (!identity || !cookieToken) return this.notAttempted();

    const record = await this.revokeLocal(identity.userId, cookieToken);
    if (!record) return this.notAttempted();

    return {
      localLogout: 'completed',
      upstreamLogout: UPSTREAM_LOGOUT.NOT_APPLICABLE,
    };
  }

  private async revokeLocal(
    userId: number,
    token: string,
  ): Promise<AuthSessionRecord | null> {
    try {
      return await this.sessions.revoke(userId, token);
    } catch (error) {
      this.logger.error({
        context: AuthLogoutService.name,
        event: 'auth.logout_revoke_failed',
        message: '本地 session 撤銷失敗',
        metadata: {
          userId,
          reason: error instanceof Error ? error.message : String(error),
        },
      });
      throw new AppException(
        AppErrorCode.AUTH_SESSION_UNAVAILABLE,
        '無法確認登入撤銷，請稍後再試',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private notAttempted(): LogoutResult {
    return {
      localLogout: 'completed',
      upstreamLogout: UPSTREAM_LOGOUT.NOT_ATTEMPTED,
    };
  }
}
