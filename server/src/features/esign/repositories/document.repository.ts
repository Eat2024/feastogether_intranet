import { Injectable } from '@nestjs/common';
import { type DeepPartial, type EntityManager, IsNull } from 'typeorm';
import { EsignDocument } from '../entities/esign-document.entity';

@Injectable()
export class DocumentRepository {
  findById(id: number, manager: EntityManager) {
    return manager.findOne(EsignDocument, {
      where: { id, deletedAt: IsNull() },
    });
  }

  findByIdForUpdate(id: number, manager: EntityManager) {
    return manager.findOne(EsignDocument, {
      where: { id, deletedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
  }

  findCreatedByUser(createdByUserId: number, manager: EntityManager) {
    return manager.find(EsignDocument, {
      where: { createdByUserId, deletedAt: IsNull() },
      order: { updatedAt: 'DESC', id: 'DESC' },
    });
  }

  create(fields: DeepPartial<EsignDocument>, manager: EntityManager) {
    return manager.create(EsignDocument, fields);
  }

  save(document: EsignDocument, manager: EntityManager) {
    return manager.save(document);
  }

  updateDraft(
    id: number,
    fields: Partial<Pick<EsignDocument, 'title'>>,
    manager: EntityManager,
  ) {
    return manager.update(
      EsignDocument,
      { id, status: 'draft', deletedAt: IsNull() },
      fields,
    );
  }

  softDeleteDraft(id: number, deletedAt: Date, manager: EntityManager) {
    return manager.update(
      EsignDocument,
      { id, status: 'draft', deletedAt: IsNull() },
      { deletedAt },
    );
  }

  findFinalizationCandidates(afterId: number, manager: EntityManager) {
    return manager
      .createQueryBuilder(EsignDocument, 'document')
      .select('document.id', 'id')
      .where("document.status = 'finalizing'")
      .andWhere('document.id > :afterId', { afterId })
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM esign_signers signer WHERE signer.document_id = document.id AND signer.deleted_at IS NULL AND (signer.status <> 'signed' OR signer.completion_status IS NULL OR signer.completion_status <> 'ready'))`,
      )
      .orderBy('document.id', 'ASC')
      .limit(100)
      .getRawMany<{ id: string }>();
  }

  findExpiredActiveIds(now: Date, manager: EntityManager, afterId = 0) {
    return manager
      .createQueryBuilder(EsignDocument, 'document')
      .select('document.id', 'id')
      .where("document.status = 'active'")
      .andWhere('document.sign_end_at <= :now', { now })
      .andWhere('document.id > :afterId', { afterId })
      .andWhere(
        `EXISTS (
          SELECT 1 FROM esign_signers signer
          WHERE signer.document_id = document.id
            AND signer.deleted_at IS NULL
            AND signer.status = 'pending'
        )`,
      )
      .orderBy('document.id', 'ASC')
      .limit(100)
      .getRawMany<{ id: string }>();
  }
}
