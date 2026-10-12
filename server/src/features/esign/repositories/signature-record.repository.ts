import { Injectable } from '@nestjs/common';
import { type DeepPartial, type EntityManager } from 'typeorm';
import { EsignSignatureRecord } from '../entities/esign-signature-record.entity';

@Injectable()
export class SignatureRecordRepository {
  insert(record: DeepPartial<EsignSignatureRecord>, manager: EntityManager) {
    return manager.insert(EsignSignatureRecord, record as never);
  }

  findBySignerId(signerId: number, manager: EntityManager) {
    return manager.findOneBy(EsignSignatureRecord, { signerId });
  }
}
