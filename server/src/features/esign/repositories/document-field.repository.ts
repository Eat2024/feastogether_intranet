import { Injectable } from '@nestjs/common';
import { type DeepPartial, type EntityManager, IsNull } from 'typeorm';
import { EsignDocumentField } from '../entities/esign-document-field.entity';

@Injectable()
export class DocumentFieldRepository {
  findByDocument(documentId: number, manager: EntityManager) {
    return manager.find(EsignDocumentField, {
      where: { documentId, deletedAt: IsNull() },
      order: { pageNumber: 'ASC', sortOrder: 'ASC', id: 'ASC' },
    });
  }

  findByDocumentForUpdate(documentId: number, manager: EntityManager) {
    return manager.find(EsignDocumentField, {
      where: { documentId, deletedAt: IsNull() },
      order: { pageNumber: 'ASC', sortOrder: 'ASC', id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
  }

  create(fields: DeepPartial<EsignDocumentField>, manager: EntityManager) {
    return manager.create(EsignDocumentField, fields);
  }

  save(fields: EsignDocumentField[], manager: EntityManager) {
    return manager.save(fields);
  }

  deleteDraftFields(documentId: number, manager: EntityManager) {
    return manager.delete(EsignDocumentField, { documentId });
  }
}
