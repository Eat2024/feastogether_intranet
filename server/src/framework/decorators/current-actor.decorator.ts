import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import type { Actor } from '#app/features/auth/auth.types';
import type { AuthenticatedRequest } from '../guards/auth.guard';

/** 僅回傳 AuthGuard 已驗證的操作者，不從 body 或 query 推導身分。 */
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor => {
    const actor = context.switchToHttp().getRequest<AuthenticatedRequest>()
      .authSession?.actor;
    if (!actor) throw new AppException(...AppErrors.AUTH_TOKEN_MISSING);
    return actor;
  },
);
