import { Controller, Get, Header, Req } from '@nestjs/common';
import { toSessionView } from '#app/features/auth/dto/session-view.dto';
import type { AuthenticatedRequest } from '#app/framework/guards/auth.guard';
import { AuthenticatedOnly } from '../decorators/require-permissions.decorator';
import type { AuthMeViewDto } from '../dto/auth-me-view.dto';
import { AuthorizationResolverService } from '../services/authorization-resolver.service';

@Controller('auth')
export class AuthMeController {
  constructor(private readonly resolver: AuthorizationResolverService) {}

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @AuthenticatedOnly()
  async current(@Req() request: AuthenticatedRequest): Promise<AuthMeViewDto> {
    const session = request.authSession!;
    const authorization = await this.resolver.resolve(session.actor);
    return {
      ...toSessionView(session),
      modules: authorization.modules,
    };
  }
}
