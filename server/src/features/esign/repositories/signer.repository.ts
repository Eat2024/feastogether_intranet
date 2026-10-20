import { Injectable } from '@nestjs/common';
import { type DeepPartial, type EntityManager, IsNull } from 'typeorm';
import { EsignSigner } from '../entities/esign-signer.entity';

@Injectable()
export class SignerRepository {
  findById(id: number, manager: EntityManager) {
    return manager.findOne(EsignSigner, {
      where: { id, deletedAt: IsNull() },
    });
  }

  findByIdForUpdate(id: number, manager: EntityManager) {
    return manager.findOne(EsignSigner, {
      where: { id, deletedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async completionCounts(documentId: number, manager: EntityManager) {
    const row = await manager
      .createQueryBuilder(EsignSigner, 'signer')
      .select('COUNT(*)', 'total')
      .addSelect("COALESCE(SUM(signer.status = 'pending'), 0)", 'pending')
      .addSelect("COALESCE(SUM(signer.status = 'signed'), 0)", 'signed')
      .addSelect(
        "COALESCE(SUM(signer.completion_status = 'ready'), 0)",
        'ready',
      )
      .where('signer.document_id = :documentId', { documentId })
      .andWhere('signer.deleted_at IS NULL')
      .getRawOne<{
        total: string;
        pending: string;
        signed: string;
        ready: string;
      }>();
    return {
      total: Number(row?.total ?? 0),
      pending: Number(row?.pending ?? 0),
      signed: Number(row?.signed ?? 0),
      ready: Number(row?.ready ?? 0),
    };
  }

  findCompletionCandidates(now: Date, afterId: number, manager: EntityManager) {
    return manager
      .createQueryBuilder(EsignSigner, 'signer')
      .innerJoin('signer.document', 'document')
      .select('signer.id', 'id')
      .addSelect('signer.document_id', 'documentId')
      .where('signer.id > :afterId', { afterId })
      .andWhere("signer.status = 'signed'")
      .andWhere(
        "document.status IN ('active','expired','finalizing','stopped')",
      )
      .andWhere(
        "(signer.completion_status IN ('pending','failed') OR (signer.completion_status = 'processing' AND signer.completion_lease_expires_at <= :now))",
        { now },
      )
      .orderBy('signer.id', 'ASC')
      .limit(100)
      .getRawMany<{ id: string; documentId: string }>();
  }

  findByPublicId(publicId: string, manager: EntityManager) {
    return manager.findOne(EsignSigner, {
      where: { publicId, deletedAt: IsNull() },
    });
  }

  findByPublicIdForUpdate(publicId: string, manager: EntityManager) {
    return manager.findOne(EsignSigner, {
      where: { publicId, deletedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
  }

  findByInvitationDigest(
    invitationTokenSha256: string,
    manager: EntityManager,
  ) {
    return manager.findOne(EsignSigner, {
      where: { invitationTokenSha256, deletedAt: IsNull() },
    });
  }

  findByDocument(documentId: number, manager: EntityManager) {
    return manager.find(EsignSigner, {
      where: { documentId, deletedAt: IsNull() },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
  }

  findByDocumentForUpdate(documentId: number, manager: EntityManager) {
    return manager.find(EsignSigner, {
      where: { documentId, deletedAt: IsNull() },
      order: { sortOrder: 'ASC', id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
  }

  findAssignedToUser(userId: number, manager: EntityManager) {
    return manager.find(EsignSigner, {
      where: { userId, deletedAt: IsNull() },
      order: { updatedAt: 'DESC', id: 'DESC' },
    });
  }

  create(fields: DeepPartial<EsignSigner>, manager: EntityManager) {
    return manager.create(EsignSigner, fields);
  }

  save(signer: EsignSigner, manager: EntityManager) {
    return manager.save(signer);
  }

  saveMany(signers: EsignSigner[], manager: EntityManager) {
    return manager.save(signers, { chunk: 250 });
  }

  deleteDraftSigners(documentId: number, manager: EntityManager) {
    return manager.delete(EsignSigner, { documentId });
  }
}
