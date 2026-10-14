import { timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import { EsignDocument } from '../entities/esign-document.entity';
import { EsignSigner } from '../entities/esign-signer.entity';
import { EsignDocumentValidationService } from './esign-document-validation.service';

@Injectable()
export class EsignAccessPolicyService {
  constructor(private readonly documents: EsignDocumentValidationService) {}

  checkEsignCreator(
    document: EsignDocument | null,
    userId: number,
  ): asserts document is EsignDocument {
    if (
      document === null ||
      document.createdByUserId !== userId ||
      document.deletedAt
    ) {
      throw this.notFound();
    }
  }

  assertInternalSigner(
    document: EsignDocument,
    signer: EsignSigner,
    userId: number,
  ): void {
    if (
      signer.signerType !== 'user' ||
      signer.userId !== userId ||
      signer.documentId !== document.id ||
      signer.deletedAt ||
      document.deletedAt
    ) {
      throw this.notFound();
    }
  }

  assertCreatorOrSignedInternalSigner(
    document: EsignDocument | null,
    signer: EsignSigner | null,
    userId: number,
  ): asserts document is EsignDocument {
    if (
      document &&
      !document.deletedAt &&
      (document.createdByUserId === userId ||
        (signer?.signerType === 'user' &&
          signer.userId === userId &&
          signer.documentId === document.id &&
          signer.status === 'signed' &&
          !signer.deletedAt))
    ) {
      return;
    }
    throw this.notFound();
  }

  assertExternalInvitation(
    document: EsignDocument | null,
    signer: EsignSigner | null,
    digest: string,
    now: Date,
  ): void {
    const valid =
      signer !== null &&
      document !== null &&
      signer.signerType === 'email' &&
      signer.documentId === document.id &&
      signer.status === 'pending' &&
      !signer.deletedAt &&
      !document.deletedAt &&
      signer.invitationTokenSha256 !== undefined &&
      this.equalDigest(signer.invitationTokenSha256, digest) &&
      signer.invitationExpiresAt !== undefined &&
      now < signer.invitationExpiresAt;
    if (!valid) throw this.externalUnauthorized();

    try {
      this.documents.assertActiveSigningWindow(document, now);
    } catch {
      throw this.externalUnauthorized();
    }
  }

  assertExternalCredential(
    document: EsignDocument | null,
    signer: EsignSigner | null,
    digest: string,
  ): asserts signer is EsignSigner {
    if (
      !document ||
      !signer ||
      signer.signerType !== 'email' ||
      signer.documentId !== document.id ||
      signer.deletedAt ||
      document.deletedAt ||
      !signer.invitationTokenSha256 ||
      !this.equalDigest(signer.invitationTokenSha256, digest)
    ) {
      throw this.externalUnauthorized();
    }
  }

  assertReceipt(
    document: EsignDocument | null,
    signer: EsignSigner | null,
    digest: string,
    now: Date,
  ): void {
    const terminal =
      document?.status === 'completed' || document?.status === 'stopped';
    const valid =
      signer !== null &&
      document !== null &&
      signer.signerType === 'email' &&
      signer.documentId === document.id &&
      signer.status === 'signed' &&
      !signer.deletedAt &&
      !document.deletedAt &&
      signer.completionReceiptSha256 !== undefined &&
      this.equalDigest(signer.completionReceiptSha256, digest) &&
      (!terminal ||
        (signer.completionReceiptExpiresAt !== undefined &&
          now < signer.completionReceiptExpiresAt));
    if (!valid) throw this.externalUnauthorized();
  }

  private equalDigest(expected: string, actual: string): boolean {
    const expectedBytes = Buffer.from(expected, 'ascii');
    const actualBytes = Buffer.from(actual, 'ascii');
    return (
      expectedBytes.byteLength === actualBytes.byteLength &&
      timingSafeEqual(expectedBytes, actualBytes)
    );
  }

  private notFound(): AppException {
    return new AppException(
      AppErrorCode.ESIGN_RESOURCE_NOT_FOUND,
      '找不到電子簽資源',
      HttpStatus.NOT_FOUND,
    );
  }

  private externalUnauthorized(): AppException {
    return new AppException(
      AppErrorCode.ESIGN_EXTERNAL_UNAUTHORIZED,
      '外部簽署存取已失效',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
