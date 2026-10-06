import { Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { EntityManager } from 'typeorm';
import { clsUserId } from '#app/infrastructure/database/audit-user.context';
import {
  CLS_CLIENT_IP,
  CLS_USER_AGENT,
} from '#app/framework/http/request.context';
import {
  AUDIT_TARGET_KIND,
  AuditAction,
} from '#app/features/auth/auth.constants';
import {
  AuditLogRepository,
  AuditLogEntry,
  AuditTargetInput,
} from '#app/features/auth/repositories/audit-log.repository';

export interface AuditLogInput {
  action: AuditAction;
  entityType: string;
  entityId: string | number;
  beforeSnapshot?: Record<string, unknown> | null;
  afterSnapshot?: Record<string, unknown> | null;
  associatedTargets?: Array<{ type: string; id: string | number | null }>;
  description?: string;
}

type AuditChanges = Record<string, [unknown, unknown]>;

/**
 * 稽核歷史共用寫入點。
 * actor 取自 CLS（登入者）、ip / ua 取自 CLS（請求中介層寫入），呼叫端只需給事件內容。
 * 可選傳入 transaction manager，與業務異動同一交易寫入。
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    private readonly auditLogs: AuditLogRepository,
    private readonly cls: ClsService,
  ) {}

  /**
   * 寫入一筆稽核歷史。
   * @remarks
   * 若 before / after 快照無任何欄位差異，會直接跳過不寫（僅記 debug log）。
   * 呼叫端不可假設一定會產生紀錄。
   */
  async recordHistory(
    input: AuditLogInput,
    manager?: EntityManager,
  ): Promise<void> {
    await this.recordHistoryBatch([input], manager);
  }

  /**
   * 一次寫入多筆稽核歷史（同 `recordHistory` 語意，但只走一次資料庫來回）。
   *
   * 用於「一個動作牽動大量實體」的場合，典型是排程批次清理：
   * 逐筆呼叫會在業務交易內產生 2N 次來回，交易愈長、鎖持有愈久。
   * 無欄位異動者一樣個別跳過；全部跳過時不發出任何寫入。
   */
  async recordHistoryBatch(
    inputs: AuditLogInput[],
    manager?: EntityManager,
  ): Promise<void> {
    const entries = inputs
      .map((input) => this.toEntry(input))
      .filter((entry): entry is AuditLogEntry => entry !== null);
    if (!entries.length) return;
    await this.auditLogs.saveManyWithTargets(entries, manager);
  }

  /** 組裝單筆寫入內容；無欄位異動時回 null（呼叫端不可假設一定會產生紀錄）。 */
  private toEntry(input: AuditLogInput): AuditLogEntry | null {
    const before = input.beforeSnapshot ?? null;
    const after = input.afterSnapshot ?? null;
    // 稽核不做中央遮蔽，但擋掉明顯敏感欄位誤入 snapshot（呼叫端仍應只傳可記錄欄位）。
    assertNoSensitiveKeys(before);
    assertNoSensitiveKeys(after);
    const changes = buildChanges(before, after);
    if (!Object.keys(changes).length) {
      this.logger.debug(
        `跳過稽核（無欄位異動）：${input.action} ${input.entityType}#${String(input.entityId)}`,
      );
      return null;
    }

    return {
      log: {
        actorUserId: this.currentActorId(),
        action: input.action,
        entityType: input.entityType,
        entityId: String(input.entityId),
        changes,
        beforeSnapshot: before,
        afterSnapshot: after,
        description: input.description,
        ipAddress: this.fromCls(CLS_CLIENT_IP),
        userAgent: this.fromCls(CLS_USER_AGENT),
      },
      targets: this.targetsFor(input),
    };
  }

  private currentActorId(): number | undefined {
    const raw = clsUserId(this.cls);
    const id = Number(raw);
    return raw && Number.isFinite(id) ? id : undefined;
  }

  private fromCls(key: string): string | undefined {
    return this.cls.isActive() ? this.cls.get<string>(key) : undefined;
  }

  private targetsFor(input: AuditLogInput): AuditTargetInput[] {
    return [
      {
        kind: AUDIT_TARGET_KIND.PRIMARY,
        type: input.entityType,
        id: input.entityId,
      },
      ...(input.associatedTargets ?? [])
        .filter(
          (target): target is { type: string; id: string | number } =>
            target.id !== null && target.id !== undefined,
        )
        .map((target) => ({
          kind: AUDIT_TARGET_KIND.ASSOCIATED,
          type: target.type,
          id: target.id,
        })),
    ];
  }
}

/** 疑似敏感的欄位名（避免密碼 / token / 雜湊等誤入可查詢的稽核 JSON）。 */
const SENSITIVE_SNAPSHOT_KEY = /pass(word)?|token|secret|hash|otp|verif/i;

function assertNoSensitiveKeys(snapshot: Record<string, unknown> | null): void {
  if (!snapshot) return;
  const hit = Object.keys(snapshot).filter((key) =>
    SENSITIVE_SNAPSHOT_KEY.test(key),
  );
  if (hit.length) {
    throw new Error(`稽核 snapshot 含疑似敏感欄位：${hit.join(', ')}`);
  }
}

export function buildChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AuditChanges {
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  return [...keys].reduce<AuditChanges>((changes, key) => {
    const beforeValue = before?.[key] ?? null;
    const afterValue = after?.[key] ?? null;
    if (isJsonEqual(beforeValue, afterValue)) return changes;
    return { ...changes, [key]: [beforeValue, afterValue] };
  }, {});
}

function isJsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => isJsonEqual(value, b[index]));
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (!isJsonEqual(aKeys, bKeys)) return false;
    return aKeys.every((key) => isJsonEqual(a[key], b[key]));
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
