import { Controller, Get, Header, Query } from '@nestjs/common';
import type { Actor } from '#app/features/auth/auth.types';
import { CurrentActor } from '#app/framework/decorators/current-actor.decorator';
import { SuperUserOnly } from '../decorators/require-permissions.decorator';
import { AuthorizationEventService } from '../services/authorization-event.service';
@Controller('authorization/events')
@SuperUserOnly()
export class AuthorizationEventsController {
  constructor(private readonly events: AuthorizationEventService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentActor() actor: Actor, @Query() query: unknown) {
    return this.events.list({ source: 'http', actor }, query);
  }
}
