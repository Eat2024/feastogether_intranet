import { Injectable } from '@nestjs/common';
import { EsignDocumentField } from '../entities/esign-document-field.entity';
import { EsignDocument } from '../entities/esign-document.entity';
import { EsignFileObject } from '../entities/esign-file-object.entity';
import { EsignSigner } from '../entities/esign-signer.entity';
import {
  integrityFailed,
  invalidRequest,
  stateConflict,
} from '../helpers/esign-errors';

@Injectable()
export class EsignDocumentValidationService {
  checkStillDraft(document: EsignDocument): void {
    if (document.status !== 'draft' || document.deletedAt) {
      throw stateConflict('文件已發起，無法修改草稿');
    }
  }

  assertActiveSigningWindow(document: EsignDocument, now: Date): void {
    if (
      document.status !== 'active' ||
      !document.signStartAt ||
      !document.signEndAt ||
      now < document.signStartAt ||
      now >= document.signEndAt
    ) {
      throw stateConflict('文件目前不在可簽署期間');
    }
  }

  assertPendingSigner(signer: EsignSigner, documentId: number): void {
    if (
      signer.documentId !== documentId ||
      signer.status !== 'pending' ||
      signer.deletedAt
    ) {
      throw stateConflict('簽署任務目前無法操作');
    }
  }

  assertFieldsBelongToSigner(
    fields: EsignDocumentField[],
    signer: EsignSigner,
  ): void {
    if (
      fields.some(
        (field) =>
          field.documentId !== signer.documentId ||
          field.signerId !== signer.id ||
          field.deletedAt,
      )
    ) {
      throw invalidRequest('簽署欄位與文件或簽署人不相符');
    }
  }

  assertSourceIntegrity(
    document: EsignDocument,
    source: EsignFileObject,
    persistedSha256: string,
  ): void {
    this.assertFileIntegrity(document, source, 'source_pdf', persistedSha256);
  }

  assertFileIntegrity(
    document: EsignDocument,
    file: EsignFileObject,
    purpose: 'source_pdf' | 'completed_pdf',
    persistedSha256: string,
  ): void {
    if (
      file.documentId !== document.id ||
      file.filePurpose !== purpose ||
      file.archiveStatus !== 'active' ||
      file.sha256 !== persistedSha256
    ) {
      throw integrityFailed();
    }
  }

  assertPayloadIntegrity(
    document: EsignDocument,
    recalculatedSha256: string,
  ): void {
    if (
      !document.signingPayloadJson ||
      !document.signingPayloadSha256 ||
      document.signingPayloadSha256 !== recalculatedSha256
    ) {
      throw integrityFailed();
    }
  }

  assertActiveForStop(document: EsignDocument): void {
    if (document.status !== 'active') {
      throw stateConflict('只有簽署中的文件可以停止');
    }
  }

  assertSignerCanReadSource(
    document: EsignDocument,
    signer: EsignSigner,
    now: Date,
  ): void {
    if (signer.status === 'signed') {
      if (
        !['active', 'finalizing', 'completed', 'stopped'].includes(
          document.status,
        )
      ) {
        throw stateConflict('簽署文件目前無法讀取');
      }
      return;
    }
    this.assertActiveSigningWindow(document, now);
  }
}
