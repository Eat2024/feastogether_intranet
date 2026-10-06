import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { cookieTokenFromMap } from '#app/common/http/cookie-token.helper';
import { CLS_AUDIT_USER_ID } from '#app/infrastructure/database/audit-user.context';
import type { FastifyRequest } from 'fastify';
import { IS_PUBLIC_KEY } from '#app/framework/decorators/public.decorator';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import {
  AuthSessionVerifierService,
  type VerifiedIdentity,
} from '#app/features/auth/services/auth-session-verifier.service';
import { ApiAuthorizationService } from '#app/features/auth/services/api-authorization.service';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import {
  REGISTER_API_KEY,
  RegisterApiMetadata,
} from '#app/framework/decorators/register-api.decorator';

interface JwtPayload {
  sub: string;
}

interface AuthenticatedRequest extends FastifyRequest {
  user?: JwtPayload & { id: string };
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: AuthSessionVerifierService,
    private readonly authorization: ApiAuthorizationService,
    private readonly cls: ClsService,
    private readonly reflector: Reflector,
    private readonly appLogger: AppLoggerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // [pre-check] 公開端點（@Public）免身分與權限驗證。
    if (this.isPublic(context)) return true;

    const token = this.extractCookieToken(req);
    if (!token) throw this.unauthorized('Missing token');
    const identity = await this.sessions.verifySessionToken(token);
    if (!identity) throw this.unauthorized('Invalid, expired or revoked token');

    this.applyIdentity(req, identity);

    const apiMeta = this.reflector.getAllAndOverride<RegisterApiMetadata>(
      REGISTER_API_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!apiMeta) {
      this.appLogger.warn({
        context: AuthGuard.name,
        event: 'authz.denied_no_meta',
        message: '端點缺 @RegisterApi 宣告，default-deny',
        metadata: {
          handler: context.getHandler()?.name,
          controller: context.getClass()?.name,
        },
      });
      throw this.forbidden();
    }

    if (apiMeta.permissions.length === 0) return true;
    if (
      await this.authorization.hasAnyPermission(
        identity.userId,
        apiMeta.permissions,
      )
    )
      return true;

    this.appLogger.warn({
      context: AuthGuard.name,
      event: 'authz.denied_no_permission',
      message: '使用者無此端點權限',
      metadata: { apiKey: apiMeta.key, userId: identity.userId },
    });
    throw this.forbidden();
  }

  private isPublic(context: ExecutionContext): boolean {
    return !!this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  }

  /** 取 token：只認 HttpOnly cookie（瀏覽器自動帶，JS 讀不到）。 */
  private extractCookieToken(req: AuthenticatedRequest): string | null {
    return cookieTokenFromMap(req.cookies, AUTH_COOKIE_NAME);
  }

  /** 將已驗證的 payload 掛到 request + CLS（供 AuditSubscriber 寫 created_by / updated_by）。 */
  private applyIdentity(
    req: AuthenticatedRequest,
    identity: VerifiedIdentity,
  ): void {
    const payload: JwtPayload = { sub: String(identity.userId) };
    req.user = { id: payload.sub, ...payload };
    if (this.cls.isActive()) {
      this.cls.set(CLS_AUDIT_USER_ID, payload.sub);
    }
  }

  /** 統一以穩定 error.code = UNAUTHORIZED 回應（憲章 III；不洩漏細節）。 */
  private unauthorized(message: string): AppException {
    return new AppException(
      AppErrorCode.UNAUTHORIZED,
      message,
      HttpStatus.UNAUTHORIZED,
    );
  }

  private forbidden(): AppException {
    return new AppException(
      AppErrorCode.FORBIDDEN,
      '權限不足',
      HttpStatus.FORBIDDEN,
    );
  }
}
