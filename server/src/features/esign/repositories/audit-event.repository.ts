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
    });
  }

  findLatestDocumentEvent(documentId: number, manager: EntityManager) {
    return manager.findOne(EsignAuditEvent, {
      where: { documentId },
      order: { occurredAt: 'DESC', id: 'DESC' },
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
