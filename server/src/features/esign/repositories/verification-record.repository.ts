import { Injectable } from '@nestjs/common';
import { type DeepPartial, type EntityManager } from 'typeorm';
import { EsignVerificationRecord } from '../entities/esign-verification-record.entity';

@Injectable()
export class VerificationRecordRepository {
  insert(record: DeepPartial<EsignVerificationRecord>, manager: EntityManager) {
    return manager.insert(EsignVerificationRecord, record as never);
  }

  findByDocumentId(documentId: number, manager: EntityManager) {
    return manager.findOneBy(EsignVerificationRecord, { documentId });
  }

  findByPublicId(publicId: string, manager: EntityManager) {
    return manager.findOneBy(EsignVerificationRecord, { publicId });
  }

  revoke(id: number, revokedAt: Date, manager: EntityManager) {
    return manager.update(
      EsignVerificationRecord,
      { id },
      { status: 'revoked', revokedAt },
    );
  }
}
