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
    private readonly cls: ClsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // 公開端點自行負責 pre-session 驗證；其餘端點預設需要有效員工 session。
    if (this.isPublic(context)) return true;

    const token = this.extractCookieToken(req);
    if (!token) throw this.unauthorized('Missing token');
    const identity = await this.sessions.verifySessionToken(token);
    if (!identity) throw this.unauthorized('Invalid, expired or revoked token');

    this.applyIdentity(req, identity);
    return true;
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

  /** 將已驗證的 payload 掛到 request + CLS（供員工稽核欄位使用）。 */
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
}
