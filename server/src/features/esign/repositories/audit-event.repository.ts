import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Injectable } from '@nestjs/common';
import { type DeepPartial, type EntityManager } from 'typeorm';
import { EsignAuditEvent } from '../entities/esign-audit-event.entity';
import { EsignDocument } from '../entities/esign-document.entity';

@Injectable()
export class AuditEventRepository {
  lockDocument(documentId: number, manager: EntityManager) {
    return manager.findOne(EsignDocument, {
      where: { id: documentId },
      select: { id: true },
      lock: { mode: 'pessimistic_write' },
      // 刪除草稿時同一交易先軟刪除再寫稽核，仍須鎖得到該文件
      withDeleted: true,
    });
  }

  findLatestDocumentEvent(
    documentId: number,
    manager: EntityManager,
    currentRead = false,
  ) {
    return manager.findOne(EsignAuditEvent, {
      where: { documentId },
      // 以鎖內追加順序接續 hash；事件發生時間可能早於取得文件鎖。
      order: { id: 'DESC' },
      // 批次呼叫端可能已有 RR 快照，鎖內必須接續當下真正的鏈尾。
      ...(currentRead ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
  }

  insert(event: DeepPartial<EsignAuditEvent>, manager: EntityManager) {
    return manager.insert(EsignAuditEvent, event as never);
  }

  /** 沿用呼叫端交易，以有界批次保留稽核追加順序。 */
  async insertMany(
    events: readonly DeepPartial<EsignAuditEvent>[],
    manager: EntityManager,
  ): Promise<void> {
    for (let offset = 0; offset < events.length; offset += 500) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(EsignAuditEvent)
        .values(
          events.slice(
            offset,
            offset + 500,
          ) as QueryDeepPartialEntity<EsignAuditEvent>[],
        )
        .updateEntity(false)
        .execute();
    }
  }

  findDocumentEvents(documentId: number, manager: EntityManager) {
    return manager.find(EsignAuditEvent, {
      where: { documentId },
      order: { id: 'ASC' },
    });
  }
}
