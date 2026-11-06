import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { IS_PUBLIC_KEY } from '#app/framework/decorators/public.decorator';
import type { AuthenticatedRequest } from '#app/framework/guards/auth.guard';
import {
  AUTHORIZATION_REQUIREMENT,
  type AuthorizationRequirement,
} from '../decorators/require-permissions.decorator';
import { AuthorizationService } from '../services/authorization.service';

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets))
      return true;
    const requirement =
      this.reflector.getAllAndOverride<AuthorizationRequirement>(
        AUTHORIZATION_REQUIREMENT,
        targets,
      );
    // 未遷移入口仍由既有 AuthGuard 保護；完整宣告由切換 readiness 掃描強制要求。
    if (!requirement) return true;
    const actor = context.switchToHttp().getRequest<AuthenticatedRequest>()
      .authSession?.actor;
    if (!actor) throw new AppException(...AppErrors.AUTH_TOKEN_MISSING);
    if (requirement.mode === 'super')
      await this.authorization.requireSuperUser(actor);
    else if (requirement.mode === 'all' || requirement.mode === 'any')
      await this.authorization.requirePermissions(
        actor,
        requirement.permissions,
        undefined,
        requirement.mode,
      );
    return true;
  }
}
