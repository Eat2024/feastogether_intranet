import { Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrors } from '#app/common/errors/app-errors';
import { AUTHORIZATION_MODULES } from '../authorization.catalog';
import { AuthorizationEventRepository } from '../repositories/authorization-event.repository';
import {
  authorizationInput,
  authorizationIdString,
  parseAuthorizationId,
  AuthorizationEventsQueryDto,
} from '../dto/authorization-query.dto';
import type { AuthorizationEventDto } from '../dto/authorization-event.dto';
import { sanitizeAuthorizationSnapshot } from './authorization-audit.service';
import {
  AuthorizationManagementService,
  type AuthorizationManagementContext,
} from './authorization-management.service';

function snapshot(
  input: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const value = sanitizeAuthorizationSnapshot(input);
  if (!value) return null;
  if (typeof value.userId === 'number')
    value.userId = authorizationIdString(value.userId);
  if (Array.isArray(value.roleIds))
    value.roleIds = value.roleIds.map((id: number) =>
      authorizationIdString(id),
    );
  return value;
}
@Injectable()
export class AuthorizationEventService {
  constructor(
    private readonly management: AuthorizationManagementService,
    private readonly events: AuthorizationEventRepository,
  ) {}
  async list(context: AuthorizationManagementContext, query: unknown = {}) {
    return this.management.read(context, async (manager) => {
      const input = authorizationInput(AuthorizationEventsQueryDto, query);
      if (
        input.moduleKey &&
        !AUTHORIZATION_MODULES.some((m) => m.moduleKey === input.moduleKey)
      )
        throw new AppException(
          ...AppErrors.AUTHORIZATION_REQUEST_FORMAT_INVALID,
        );
      const rows = await this.events.list(manager, {
        moduleKey: input.moduleKey,
        beforeId: input.beforeId
          ? parseAuthorizationId(input.beforeId)
          : undefined,
        limit: input.limit + 1,
      });
      const items: AuthorizationEventDto[] = rows
        .slice(0, input.limit)
        .map((e) => ({
          id: authorizationIdString(e.id),
          occurredAt: e.occurredAt.toISOString(),
          actorKind: e.actorKind,
          source: e.source,
          moduleKey: e.moduleKey,
          eventType: e.eventType,
          targetKind: e.targetKind,
          targetId:
            e.targetId === null ? null : authorizationIdString(e.targetId),
          before: snapshot(e.beforeJson),
          after: snapshot(e.afterJson),
        }));
      return {
        items,
        nextCursor:
          rows.length > input.limit ? (items.at(-1)?.id ?? null) : null,
      };
    });
  }
}
