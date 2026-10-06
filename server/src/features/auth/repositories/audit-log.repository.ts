import { Injectable } from '@nestjs/common';
import { DeepPartial, EntityManager } from 'typeorm';
import { AuditLog } from '#app/features/auth/entities/audit-log.entity';
import { AuditLogTarget } from '#app/features/auth/entities/audit-log-target.entity';
import { MysqlEntityService } from '#app/infrastructure/database/mysql/mysql.entity.service';
import {
  AuditHistoryQuery,
  AuditHistoryRow,
  buildAuditHistoryQuery,
  enrichWithActors,
} from '#app/features/auth/repositories/audit-log-query';

export interface AuditTargetInput {
  kind: string;
  type: string;
  id: string | number;
}

/** 一筆稽核紀錄與它的 target（批次寫入用）。 */
export interface AuditLogEntry {
  log: DeepPartial<AuditLog>;
  targets: AuditTargetInput[];
}

@Injectable()
export class AuditLogRepository {
  constructor(private readonly db: MysqlEntityService) {}

  async saveWithTargets(
    input: DeepPartial<AuditLog>,
    targets: AuditTargetInput[],
    manager?: EntityManager,
  ): Promise<void> {
    return this.saveManyWithTargets([{ log: input, targets }], manager);
  }

  async saveManyWithTargets(
    entries: AuditLogEntry[],
    manager?: EntityManager,
  ): Promise<void> {
    const validated = entries.map((entry) => {
      const changes = entry.log.changes;
      if (
        !changes ||
        typeof changes !== 'object' ||
        !Object.keys(changes).length
      ) {
        throw new Error('AuditLog.changes 不可為空');
      }
      const targets = this.uniqueTargets(entry.targets);
      if (!targets.length) {
        throw new Error('saveWithTargets：至少需要一個 target');
      }
      return { log: entry.log, targets };
    });

    const persist = async (tx: EntityManager): Promise<void> => {
      const targetsByEntity = new Map<AuditLog, AuditTargetInput[]>();
      const drafts = validated.map((entry) => {
        const draft = tx.create(AuditLog, entry.log);
        targetsByEntity.set(draft, entry.targets);
        return draft;
      });

      const logs = await tx.save(AuditLog, drafts);
      const rows = logs.flatMap((log) =>
        (targetsByEntity.get(log) ?? []).map((target) => ({
          auditLogId: Number(log.id),
          targetKind: target.kind,
          targetType: target.type,
          targetId: String(target.id),
        })),
      );
      await tx.save(AuditLogTarget, tx.create(AuditLogTarget, rows));
    };

    if (manager) return persist(manager);
    await this.db.auditLog.manager.transaction(persist);
  }

  async findHistoryBy(query: AuditHistoryQuery): Promise<AuditHistoryRow[]> {
    const logs = await buildAuditHistoryQuery(
      this.db.auditLog,
      query,
    ).getMany();
    return enrichWithActors(logs, this.db.authUser);
  }

  private uniqueTargets(targets: AuditTargetInput[]): AuditTargetInput[] {
    const seen = new Set<string>();
    return targets.filter((target) => {
      const key = `${target.kind}:${target.type}:${String(target.id)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
