import { Controller, Get, Header } from '@nestjs/common';
import type { Actor } from '#app/features/auth/auth.types';
import { CurrentActor } from '#app/framework/decorators/current-actor.decorator';
import { AuthenticatedOnly } from '../decorators/require-permissions.decorator';
import { AuthorizationResolverService } from '../services/authorization-resolver.service';
import type { AuthorizationViewDto } from '../dto/authorization-view.dto';

@Controller('me/authorization')
export class CurrentAuthorizationController {
  constructor(private readonly resolver: AuthorizationResolverService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @AuthenticatedOnly()
  current(@CurrentActor() actor: Actor): Promise<AuthorizationViewDto> {
    return this.resolver.resolve(actor);
  }
}
