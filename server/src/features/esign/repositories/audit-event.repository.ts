import { Injectable } from '@nestjs/common';
import { type DeepPartial, type EntityManager } from 'typeorm';
import { EsignAuditEvent } from '../entities/esign-audit-event.entity';

@Injectable()
export class AuditEventRepository {
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
