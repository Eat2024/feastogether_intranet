import { AppErrors } from '#app/common/errors/app-errors';
import type { EntityManager } from 'typeorm';
import { timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
import { EsignDocument } from '../entities/esign-document.entity';
import { EsignSigner } from '../entities/esign-signer.entity';
import { DocumentRepository } from '../repositories/document.repository';
import { EsignDocumentValidationService } from './esign-document-validation.service';

@Injectable()
export class EsignAccessPolicyService {
  constructor(
    private readonly documents: EsignDocumentValidationService,
    private readonly documentRepository: DocumentRepository,
  ) {}

  /**
   * 沿用呼叫端交易，以悲觀鎖鎖定文件並驗證建立人與草稿狀態。
   * 鎖定持續到交易結束，期間其他請求無法發起、刪除或修改此文件。
   */
  async checkAndLockDraftDoc(
    documentId: number,
    userId: number,
    manager: EntityManager,
  ): Promise<EsignDocument> {
    const document = await this.documentRepository.findByIdForUpdate(
      documentId,
      manager,
    );
    this.checkEsignCreator(document, userId);
    this.documents.checkStillDraft(document);
    return document;
  }

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

  /**
   * 外部存取（開啟任務、讀原始 PDF、下載本人副本、重送同一次簽名）。
   * 共同條件：憑證相符、email 簽署人、簽署人與文件未刪除。
   * 已簽者不比對期限、文件狀態與簽署期間；待簽者須在邀請期限與有效簽署期間內。
   * 待簽者在簽署開始前回 409 告知開始時間；其餘失敗一律回通用 401，不區分原因。
   */
  assertExternalAccess(
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
      !signer.deletedAt &&
      !document.deletedAt &&
      signer.invitationTokenSha256 != null &&
      this.equalDigest(signer.invitationTokenSha256, digest);
    if (!valid) throw this.externalUnauthorized();
    if (signer.status === 'signed') return;
    this.assertPendingInvitation(document, signer, now);
  }

  /** 送出新簽名：先通過外部存取，且必須是待簽者 */
  assertExternalInvitation(
    document: EsignDocument | null,
    signer: EsignSigner | null,
    digest: string,
    now: Date,
  ): void {
    this.assertExternalAccess(document, signer, digest, now);
    if (signer?.status !== 'pending') throw this.externalUnauthorized();
  }

  private assertPendingInvitation(
    document: EsignDocument,
    signer: EsignSigner,
    now: Date,
  ): void {
    if (
      signer.status !== 'pending' ||
      signer.invitationExpiresAt == null ||
      now >= signer.invitationExpiresAt
    ) {
      throw this.externalUnauthorized();
    }
    this.assertSigningStarted(document, now);
    try {
      this.documents.assertActiveSigningWindow(document, now);
    } catch {
      throw this.externalUnauthorized();
    }
  }

  /**
   * 呼叫端須先確認憑證有效且簽署人待簽：簽署中但尚未到開始時間時告知開始時間；
   * 其他期間外情況交由簽署期間檢查，維持通用失效。
   */
  private assertSigningStarted(document: EsignDocument, now: Date): void {
    const startAt = document.signStartAt;
    if (document.status === 'active' && startAt && now < startAt) {
      throw new AppException(...AppErrors.ESIGN_SIGNING_NOT_STARTED(startAt), {
        startAt: startAt.toISOString(),
      });
    }
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
    return new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
  }

  private externalUnauthorized(): AppException {
    return new AppException(...AppErrors.ESIGN_EXTERNAL_UNAUTHORIZED);
  }
}
