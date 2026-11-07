import { Injectable } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import type { EntityManager } from 'typeorm';
import { AuditLogService } from '#app/features/audit/services/audit-log.service';

export const AUTHORIZATION_EVENT_TYPES = [
  'catalog.synced',
  'role.created',
  'role.updated',
  'role.deleted',
  'role.permissions_updated',
  'user.roles_updated',
] as const;
export type AuthorizationEventType = (typeof AUTHORIZATION_EVENT_TYPES)[number];
export interface AuthorizationAuditContext {
  actorKind: 'super_user' | 'operator' | 'system';
  source: 'http' | 'repl' | 'migration';
  requestId?: string;
}

/** 只接受平面設定與有效本地 ID；不序列化傳入的任意物件。 */
export function sanitizeAuthorizationSnapshot(
  input: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!input) return null;
  const result: Record<string, unknown> = {};
  for (const [key, max] of [
    ['roleCode', 80],
    ['roleName', 100],
  ] as const) {
    if (typeof input[key] === 'string' && input[key].length <= max)
      result[key] = input[key];
  }
  if (typeof input.isActive === 'boolean') result.isActive = input.isActive;
  for (const key of ['version', 'userId'] as const) {
    if (
      typeof input[key] === 'number' &&
      Number.isSafeInteger(input[key]) &&
      input[key] > 0
    )
      result[key] = input[key];
  }
  if (
    Array.isArray(input.permissionKeys) &&
    input.permissionKeys.every(
      (key: unknown) =>
        typeof key === 'string' && /^[a-z][a-z0-9.-]{0,99}$/.test(key),
    )
  )
    result.permissionKeys = [...new Set(input.permissionKeys)].sort();
  if (
    Array.isArray(input.roleIds) &&
    input.roleIds.every(
      (id: unknown) =>
        typeof id === 'number' && Number.isSafeInteger(id) && id > 0,
    )
  )
    result.roleIds = [...new Set<number>(input.roleIds)].sort((a, b) => a - b);
  return result;
}

/** 所有異動事件跟業務資料共用交易；裁切後相同代表 no-op。 */
@Injectable()
export class AuthorizationAuditService {
  constructor(private readonly auditLogs: AuditLogService) {}
  async append(
    input: {
      context: AuthorizationAuditContext;
      moduleKey: string;
      eventType: AuthorizationEventType;
      targetKind: 'role' | 'user' | 'catalog';
      targetId?: number | null;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    },
    manager: EntityManager,
  ): Promise<void> {
    if (!manager.queryRunner?.isTransactionActive)
      throw new Error('授權稽核必須在業務交易內寫入');
    if (!AUTHORIZATION_EVENT_TYPES.includes(input.eventType))
      throw new Error('未知授權事件種類');
    const beforeJson = sanitizeAuthorizationSnapshot(input.before);
    const afterJson = sanitizeAuthorizationSnapshot(input.after);
    if (isDeepStrictEqual(beforeJson, afterJson)) return;
    await this.auditLogs.record(
      {
        action: input.eventType,
        entityType: input.targetKind,
        entityId: input.targetId ?? input.moduleKey,
        actorUserId: null,
        actorKind: input.context.actorKind,
        source: input.context.source,
        requestId: input.context.requestId?.slice(0, 64) ?? null,
        moduleKey: input.moduleKey,
        beforeSnapshot: beforeJson,
        afterSnapshot: afterJson,
      },
      manager,
    );
  }
}
