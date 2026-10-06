import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { AUDIT_TARGET_KIND } from '#app/features/auth/auth.constants';
import { AuditLog } from '#app/features/auth/entities/audit-log.entity';
import { AuthUser } from '#app/features/auth/entities/auth-user.entity';

export interface AuditHistoryRow {
  id: number;
  action: string;
  entityType: string;
  entityId: string;
  changedAt: Date;
  actorUserId?: number;
  actorEmpid?: string;
  actorName?: string;
  changes: Record<string, [unknown, unknown]>;
  beforeSnapshot?: Record<string, unknown> | null;
  afterSnapshot?: Record<string, unknown> | null;
  description?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditHistoryQuery {
  targetType: string;
  targetId: string | number;
  targetKind?: string;
  action?: string | string[];
  actorUserId?: number;
  changedFrom?: Date;
  changedTo?: Date;
  associatedTargetType?: string;
  associatedTargetId?: string | number;
  /** 回傳筆數上限（預設 200，避免熱門 target 一次全撈進記憶體）。 */
  limit?: number;
  /** 分頁位移（配合 limit）。 */
  offset?: number;
  /**
   * 時間排序方向，預設 `ASC`（既有呼叫端的行為，不變）。
   *
   * 與 `limit` 合起來才看得出重要性：`ASC` + `limit` 取到的是**最舊的 N 筆**。
   * 畫面要「最近改了什麼」時 MUST 指定 `DESC`，否則超過上限後使用者永遠看不到近期異動。
   */
  order?: 'ASC' | 'DESC';
}

/** 未指定 limit 時的安全上限。 */
const DEFAULT_AUDIT_HISTORY_LIMIT = 200;

/**
 * 稽核歷史查詢的唯一建構點：repository 與 REPL 共用，避免 filter 條件兩份漂移。
 * 傳入任一 AuditLog repository（DI 注入或 ds.getRepository 皆可）。
 *
 * 以 EXISTS 相關子查詢比對 target，刻意不用 innerJoin + distinct：
 * 無 join → take/skip 直接產生 LIMIT/OFFSET（不觸發 TypeORM 對 join 的
 * distinct-id 兩段式查詢，避免在分頁前先對 LONGTEXT 欄位做全量 DISTINCT）；
 * 且天生不會因一筆 log 有多個 target 而重複。
 */
export function buildAuditHistoryQuery(
  repo: Repository<AuditLog>,
  query: AuditHistoryQuery,
): SelectQueryBuilder<AuditLog> {
  const primaryExists =
    'EXISTS (SELECT 1 FROM audit_log_targets t' +
    ' WHERE t.audit_log_id = log.id' +
    ' AND t.target_type = :targetType AND t.target_id = :targetId' +
    (query.targetKind ? ' AND t.target_kind = :targetKind' : '') +
    ')';

  const qb = repo
    .createQueryBuilder('log')
    .where(primaryExists, {
      targetType: query.targetType,
      targetId: String(query.targetId),
      ...(query.targetKind ? { targetKind: query.targetKind } : {}),
    })
    .orderBy('log.createdAt', query.order ?? 'ASC')
    .addOrderBy('log.id', query.order ?? 'ASC');

  if (query.action) {
    const actions = Array.isArray(query.action) ? query.action : [query.action];
    qb.andWhere('log.action IN (:...actions)', { actions });
  }
  if (query.actorUserId !== undefined) {
    qb.andWhere('log.actorUserId = :actorUserId', {
      actorUserId: query.actorUserId,
    });
  }
  if (query.changedFrom) {
    qb.andWhere('log.createdAt >= :changedFrom', {
      changedFrom: query.changedFrom,
    });
  }
  if (query.changedTo) {
    qb.andWhere('log.createdAt <= :changedTo', {
      changedTo: query.changedTo,
    });
  }
  if (query.associatedTargetType && query.associatedTargetId !== undefined) {
    qb.andWhere(
      'EXISTS (SELECT 1 FROM audit_log_targets at' +
        ' WHERE at.audit_log_id = log.id' +
        ' AND at.target_kind = :associatedTargetKind' +
        ' AND at.target_type = :associatedTargetType' +
        ' AND at.target_id = :associatedTargetId)',
      {
        associatedTargetKind: AUDIT_TARGET_KIND.ASSOCIATED,
        associatedTargetType: query.associatedTargetType,
        associatedTargetId: String(query.associatedTargetId),
      },
    );
  }

  qb.take(query.limit ?? DEFAULT_AUDIT_HISTORY_LIMIT);
  if (query.offset != null) qb.skip(query.offset);

  return qb;
}

/**
 * 將查到的 logs 補上操作者顯示資訊（empid / name）並轉成回傳列。
 * 用 withDeleted 讓操作者被軟刪後歷史仍可顯示其姓名。
 */
export async function enrichWithActors(
  logs: AuditLog[],
  userRepo: Repository<AuthUser>,
): Promise<AuditHistoryRow[]> {
  const actorById = await actorMap(logs, userRepo);
  return logs.map((log) => toHistoryRow(log, actorById));
}

async function actorMap(
  logs: AuditLog[],
  userRepo: Repository<AuthUser>,
): Promise<Map<number, AuthUser>> {
  const actorIds = [
    ...new Set(
      logs
        .map((log) => log.actorUserId)
        .filter((id): id is number => id !== undefined && id !== null),
    ),
  ];
  if (!actorIds.length) return new Map();
  const actors = await userRepo.find({
    where: { id: In(actorIds) },
    select: { id: true, personEmpid: true, personName: true },
    withDeleted: true,
  });
  return new Map(actors.map((actor) => [Number(actor.id), actor]));
}

function toHistoryRow(
  log: AuditLog,
  actorById: Map<number, AuthUser>,
): AuditHistoryRow {
  const actor = log.actorUserId
    ? actorById.get(Number(log.actorUserId))
    : undefined;
  return {
    id: Number(log.id),
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    changedAt: log.createdAt,
    actorUserId: log.actorUserId,
    actorEmpid: actor?.personEmpid,
    actorName: actor?.personName,
    changes: log.changes,
    beforeSnapshot: log.beforeSnapshot,
    afterSnapshot: log.afterSnapshot,
    description: log.description,
    ipAddress: log.ipAddress,
    userAgent: log.userAgent,
  };
}
