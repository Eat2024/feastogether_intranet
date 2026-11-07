import { Injectable } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import type { EntityManager } from 'typeorm';
import { AuditLogRepository } from '../repositories/audit-log.repository';

export interface AuditLogInput {
  action: string;
  entityType: string;
  entityId: string | number;
  actorUserId?: number | null;
  actorKind: 'employee' | 'super_user' | 'operator' | 'system';
  source: 'http' | 'repl' | 'migration' | 'worker';
  moduleKey?: string | null;
  requestId?: string | null;
  beforeSnapshot: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown> | null;
  description?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** 避免密碼、token、雜湊與驗證碼誤入可查詢的稽核 JSON。 */
const SENSITIVE_SNAPSHOT_KEY = /pass(word)?|token|secret|hash|otp|verif/i;

function assertNoSensitiveKeys(
  snapshot: Record<string, unknown> | null,
): void {
  if (!snapshot) return;
  const keys = Object.keys(snapshot).filter((key) =>
    SENSITIVE_SNAPSHOT_KEY.test(key),
  );
  if (keys.length)
    throw new Error(`稽核 snapshot 含疑似敏感欄位：${keys.join(', ')}`);
}

/** CKS 同型的共用稽核寫入點；業務服務須傳入自己的交易 manager。 */
@Injectable()
export class AuditLogService {
  constructor(private readonly logs: AuditLogRepository) {}

  async record(input: AuditLogInput, manager: EntityManager): Promise<void> {
    if (!manager.queryRunner?.isTransactionActive)
      throw new Error('稽核必須在業務交易內寫入');
    assertNoSensitiveKeys(input.beforeSnapshot);
    assertNoSensitiveKeys(input.afterSnapshot);
    const changes = buildChanges(input.beforeSnapshot, input.afterSnapshot);
    if (!Object.keys(changes).length) return;
    await this.logs.append(
      {
        action: input.action,
        entityType: input.entityType,
        entityId: String(input.entityId),
        actorUserId: input.actorUserId ?? null,
        actorKind: input.actorKind,
        source: input.source,
        moduleKey: input.moduleKey ?? null,
        requestId: input.requestId?.slice(0, 64) ?? null,
        changes,
        beforeSnapshot: input.beforeSnapshot,
        afterSnapshot: input.afterSnapshot,
        description: input.description ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
      manager,
    );
  }
}

export function buildChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Record<string, [unknown, unknown]> {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes: Record<string, [unknown, unknown]> = {};
  for (const key of keys) {
    const previous = before?.[key] ?? null;
    const next = after?.[key] ?? null;
    if (!isDeepStrictEqual(previous, next)) changes[key] = [previous, next];
  }
  return changes;
}
