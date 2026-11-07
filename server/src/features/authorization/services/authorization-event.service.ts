import { Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrors } from '#app/common/errors/app-errors';
import { AUTHORIZATION_MODULES } from '../authorization.catalog';
import { AuditLogRepository } from '#app/features/audit/repositories/audit-log.repository';
import type { AuditLog } from '#app/features/audit/entities/audit-log.entity';
import {
  authorizationInput,
  authorizationIdString,
  parseAuthorizationId,
  AuthorizationEventsQueryDto,
} from '../dto/authorization-query.dto';
import type { AuthorizationEventDto } from '../dto/authorization-event.dto';
import {
  AUTHORIZATION_EVENT_TYPES,
  sanitizeAuthorizationSnapshot,
} from './authorization-audit.service';
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

function actorKind(value: AuditLog['actorKind']): AuthorizationEventDto['actorKind'] {
  if (value === 'super_user' || value === 'operator' || value === 'system')
    return value;
  throw new AppException(...AppErrors.AUTHORIZATION_UNAVAILABLE);
}

function source(value: AuditLog['source']): AuthorizationEventDto['source'] {
  if (value === 'http' || value === 'repl' || value === 'migration')
    return value;
  throw new AppException(...AppErrors.AUTHORIZATION_UNAVAILABLE);
}

function target(row: AuditLog): {
  kind: AuthorizationEventDto['targetKind'];
  id: string | null;
} {
  if (row.entityType === 'catalog') return { kind: 'catalog', id: null };
  if (row.entityType !== 'role' && row.entityType !== 'user')
    throw new AppException(...AppErrors.AUTHORIZATION_UNAVAILABLE);
  const id = Number(row.entityId);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new AppException(...AppErrors.AUTHORIZATION_UNAVAILABLE);
  return { kind: row.entityType, id: authorizationIdString(id) };
}

@Injectable()
export class AuthorizationEventService {
  constructor(
    private readonly management: AuthorizationManagementService,
    private readonly events: AuditLogRepository,
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
        actions: AUTHORIZATION_EVENT_TYPES,
        beforeId: input.beforeId
          ? parseAuthorizationId(input.beforeId)
          : undefined,
        limit: input.limit + 1,
      });
      const items: AuthorizationEventDto[] = rows
        .slice(0, input.limit)
        .map((row) => {
          if (!row.moduleKey)
            throw new AppException(...AppErrors.AUTHORIZATION_UNAVAILABLE);
          const auditTarget = target(row);
          return {
            id: authorizationIdString(row.id),
            occurredAt: row.createdAt.toISOString(),
            actorKind: actorKind(row.actorKind),
            source: source(row.source),
            moduleKey: row.moduleKey,
            eventType: row.action,
            targetKind: auditTarget.kind,
            targetId: auditTarget.id,
            before: snapshot(row.beforeSnapshot),
            after: snapshot(row.afterSnapshot),
          };
        });
      return {
        items,
        nextCursor:
          rows.length > input.limit ? (items.at(-1)?.id ?? null) : null,
      };
    });
  }
}
