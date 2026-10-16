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

  findByInvitationDigestForUpdate(
    invitationTokenSha256: string,
    manager: EntityManager,
  ) {
    return manager.findOne(EsignSigner, {
      where: { invitationTokenSha256, deletedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
  }

  findByReceiptDigest(completionReceiptSha256: string, manager: EntityManager) {
    return manager.findOne(EsignSigner, {
      where: { completionReceiptSha256, deletedAt: IsNull() },
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
    return manager.save(signers);
  }

  deleteDraftSigners(documentId: number, manager: EntityManager) {
    return manager.delete(EsignSigner, { documentId });
  }
}
