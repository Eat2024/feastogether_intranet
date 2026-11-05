import { AppErrors } from '#app/common/errors/app-errors';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { cookieTokenFromMap } from '#app/common/http/cookie-token.helper';
import { CLS_AUDIT_USER_ID } from '#app/infrastructure/database/audit-user.context';
import type { FastifyRequest } from 'fastify';
import { IS_PUBLIC_KEY } from '#app/framework/decorators/public.decorator';
import { ALLOW_SUPER_USER_KEY } from '#app/framework/decorators/allow-super-user.decorator';
import { AppException } from '#app/common/errors/app.exception';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import type { AuthenticatedSession } from '#app/features/auth/auth.types';
import { SessionService } from '#app/features/auth/services/session.service';

export interface AuthenticatedRequest extends FastifyRequest {
  /** 只有員工會話才有；Super user 不偽造員工 ID。 */
  user?: { id: string; sub: string };
  /** 已驗證會話（含 actor）；供明確允許 Super user 的端點讀取目前身分。 */
  authSession?: AuthenticatedSession;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly cls: ClsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 公開端點自行負責 pre-session 驗證；其餘端點預設需要有效會話。
    if (this.hasMetadata(context, IS_PUBLIC_KEY)) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // 只認 HttpOnly cookie（瀏覽器自動帶，JS 讀不到）。
    const token = cookieTokenFromMap(req.cookies, AUTH_COOKIE_NAME);
    if (!token) throw new AppException(...AppErrors.AUTH_TOKEN_MISSING);
    const session = await this.sessions.authenticate(token);
    if (!session) throw new AppException(...AppErrors.AUTH_TOKEN_INVALID);

    if (session.actor.kind === 'super_user') {
      if (!this.hasMetadata(context, ALLOW_SUPER_USER_KEY)) {
        throw new AppException(...AppErrors.AUTH_ACTOR_NOT_ALLOWED);
      }
      req.authSession = session;
      return true;
    }

    const { userId } = session.actor;
    if (!Number.isSafeInteger(userId) || userId < 1) {
      throw new AppException(...AppErrors.AUTH_IDENTITY_INVALID);
    }
    // 員工 ID 掛到 request 與 CLS（供員工稽核欄位使用）。
    const sub = String(userId);
    req.user = { id: sub, sub };
    req.authSession = session;
    if (this.cls.isActive()) this.cls.set(CLS_AUDIT_USER_ID, sub);
    return true;
  }

  private hasMetadata(context: ExecutionContext, key: string): boolean {
    return !!this.reflector.getAllAndOverride<boolean>(key, [
      context.getHandler(),
      context.getClass(),
    ]);
  }
}
