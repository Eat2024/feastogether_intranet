import { AppErrors } from '#app/common/errors/app-errors';
import { Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
import { EsignDocumentField } from '../entities/esign-document-field.entity';
import { EsignDocument } from '../entities/esign-document.entity';
import { EsignFileObject } from '../entities/esign-file-object.entity';
import { EsignSigner } from '../entities/esign-signer.entity';
import { canonicalJson } from './esign-audit.service';

export function effectiveDocumentStatus(
  document: EsignDocument,
  pendingCount: number,
  now: Date,
): string {
  return document.status === 'active' &&
    pendingCount > 0 &&
    document.signEndAt &&
    now >= document.signEndAt
    ? 'expired'
    : document.status;
}

@Injectable()
export class EsignDocumentValidationService {
  checkStillDraft(document: EsignDocument): void {
    if (document.status !== 'draft' || document.deletedAt) {
      throw new AppException(...AppErrors.ESIGN_DRAFT_NOT_EDITABLE);
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
      throw new AppException(...AppErrors.ESIGN_OUTSIDE_SIGNING_WINDOW);
    }
  }

  assertPendingSigner(signer: EsignSigner, documentId: number): void {
    if (
      signer.documentId !== documentId ||
      signer.status !== 'pending' ||
      signer.deletedAt
    ) {
      throw new AppException(...AppErrors.ESIGN_SIGNING_TASK_UNAVAILABLE);
    }
  }

  assertFieldsBelongToDocument(
    fields: EsignDocumentField[],
    documentId: number,
  ): void {
    if (
      fields.some((field) => field.documentId !== documentId || field.deletedAt)
    ) {
      throw new AppException(...AppErrors.ESIGN_FIELD_DOCUMENT_MISMATCH);
    }
  }

  assertSourceIntegrity(
    document: EsignDocument,
    source: EsignFileObject,
    persistedSha256: string,
  ): void {
    this.assertFileIntegrity(document, source, 'source_pdf', persistedSha256);
  }

  /** 目前讀出的原檔與共用位置必須仍等於發起時固定的內容。 */
  assertSigningSnapshot(
    document: EsignDocument,
    sourceSha256: string,
    fields: EsignDocumentField[],
  ): void {
    const payload = document.signingPayloadJson;
    const snapshotDocument = payload?.document;
    const currentFields = fields.map((field) => ({
      id: String(field.id),
      type: field.fieldType,
      page: field.pageNumber,
      xPercent: Number(field.xPercent),
      yPercent: Number(field.yPercent),
      widthPercent: Number(field.widthPercent),
      heightPercent: Number(field.heightPercent),
      sortOrder: field.sortOrder,
    }));
    if (
      !snapshotDocument ||
      typeof snapshotDocument !== 'object' ||
      !('sourceFileSha256' in snapshotDocument) ||
      snapshotDocument.sourceFileSha256 !== sourceSha256 ||
      !Array.isArray(payload?.fields) ||
      canonicalJson(payload.fields.map(canonicalJson).sort()) !==
        canonicalJson(currentFields.map(canonicalJson).sort())
    ) {
      throw this.integrityFailed();
    }
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
      throw this.integrityFailed();
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
      throw this.integrityFailed();
    }
  }

  assertActiveForStop(document: EsignDocument): void {
    if (!['active', 'expired', 'finalizing'].includes(document.status)) {
      throw new AppException(...AppErrors.ESIGN_DOCUMENT_NOT_STOPPABLE);
    }
  }

  assertSignerCanReadSource(
    document: EsignDocument,
    signer: EsignSigner,
    now: Date,
  ): void {
    if (signer.status === 'signed') {
      if (
        !['active', 'expired', 'finalizing', 'completed', 'stopped'].includes(
          document.status,
        )
      ) {
        throw new AppException(...AppErrors.ESIGN_SOURCE_UNAVAILABLE);
      }
      return;
    }
    this.assertActiveSigningWindow(document, now);
  }

  private integrityFailed(): AppException {
    return new AppException(...AppErrors.ESIGN_INTEGRITY_FAILED);
  }
}
