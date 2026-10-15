import { Injectable } from '@nestjs/common';
import { type DeepPartial, type EntityManager } from 'typeorm';
import { EsignFileObject } from '../entities/esign-file-object.entity';

@Injectable()
export class FileObjectRepository {
  findDocumentFile(
    documentId: number,
    filePurpose: string,
    manager: EntityManager,
  ) {
    return manager.findOneBy(EsignFileObject, {
      documentId,
      filePurpose,
      archiveStatus: 'active',
    });
  }

  findSignatureFiles(signatureRecordId: number, manager: EntityManager) {
    return manager.find(EsignFileObject, {
      where: {
        signatureRecordId,
        filePurpose: 'signature_png',
        archiveStatus: 'active',
      },
      order: { documentFieldId: 'ASC', id: 'ASC' },
    });
  }

  create(fields: DeepPartial<EsignFileObject>, manager: EntityManager) {
    return manager.create(EsignFileObject, fields);
  }

  save(file: EsignFileObject, manager: EntityManager) {
    return manager.save(file);
  }

  insertMany(
    files: Array<DeepPartial<EsignFileObject>>,
    manager: EntityManager,
  ) {
    return manager.insert(EsignFileObject, files as never);
  }

  deleteById(id: number, manager: EntityManager) {
    return manager.delete(EsignFileObject, { id });
  }
}
