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

  findLatestDocumentEvent(documentId: number, manager: EntityManager) {
    return manager.findOne(EsignAuditEvent, {
      where: { documentId },
      // 以鎖內追加順序接續 hash；事件發生時間可能早於取得文件鎖。
      order: { id: 'DESC' },
    });
  }

  insert(event: DeepPartial<EsignAuditEvent>, manager: EntityManager) {
    return manager.insert(EsignAuditEvent, event as never);
  }

  findDocumentEvents(documentId: number, manager: EntityManager) {
    return manager.find(EsignAuditEvent, {
      where: { documentId },
      order: { occurredAt: 'ASC', id: 'ASC' },
    });
  }
}
