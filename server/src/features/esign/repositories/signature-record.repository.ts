import { Injectable } from '@nestjs/common';
import { type DeepPartial, type EntityManager, In } from 'typeorm';
import { EsignSignatureRecord } from '../entities/esign-signature-record.entity';

@Injectable()
export class SignatureRecordRepository {
  insert(record: DeepPartial<EsignSignatureRecord>, manager: EntityManager) {
    return manager.insert(EsignSignatureRecord, record as never);
  }

  findBySignerId(signerId: number, manager: EntityManager) {
    return manager.findOneBy(EsignSignatureRecord, { signerId });
  }

  findByAuthenticationEventId(
    authenticationEventId: string,
    manager: EntityManager,
  ) {
    return manager.findOneBy(EsignSignatureRecord, { authenticationEventId });
  }

  findBySignerIds(signerIds: number[], manager: EntityManager) {
    if (signerIds.length === 0) return Promise.resolve([]);
    return manager.find(EsignSignatureRecord, {
      where: { signerId: In(signerIds) },
      order: { id: 'ASC' },
    });
  }
}
