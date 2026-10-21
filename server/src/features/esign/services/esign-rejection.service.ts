import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { EsignDocument } from '../entities/esign-document.entity';
import type { EsignSigner } from '../entities/esign-signer.entity';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { RejectionDto } from '../dto/rejection.dto';
import { DocumentRepository } from '../repositories/document.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { EsignAuditService } from './esign-audit.service';
import { EsignJobProducerService } from './esign-job-producer.service';
import type { SigningPrincipal } from './esign-signing.service';

@Injectable()
export class EsignRejectionService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly access: EsignAccessPolicyService,
    private readonly validation: EsignDocumentValidationService,
    private readonly audit: EsignAuditService,
    private readonly jobs: EsignJobProducerService,
  ) {}

  async reject(
    signerId: string,
    principal: SigningPrincipal,
    input: RejectionDto,
  ) {
    const reason = this.normalizeReason(input.reason);
    // 先取得不變的歸屬；交易內第一個讀取必須是文件鎖，避免 RR 舊快照漏看其他人的終態。
    const candidate = await this.signers.findByPublicId(
      signerId,
      this.mysql.getManager(),
    );
    const result = await this.mysql.transaction(async (manager) => {
      const { document, signer } = await this.lockSigningContext(
        signerId,
        candidate?.documentId,
        manager,
      );
      this.checkSignerIdentity(document, signer, principal);
      const repeated =
        signer.status === 'rejected' &&
        signer.rejectRequestId === input.requestId &&
        signer.rejectReason === reason;
      if (!repeated) {
        this.assertRejectionAllowed(document, signer);
        await this.saveRejection(
          signer,
          principal,
          input.requestId,
          reason,
          manager,
        );
        await this.markDocumentFinalizing(document, manager);
      }
      return {
        signerPublicId: signerId,
        status: 'rejected' as const,
        rejectedAt: signer.rejectedAt!.toISOString(),
        reason: signer.rejectReason!,
        repeated,
        documentId: document.id,
        signerId: signer.id,
      };
    });
    // 拒簽不產製 PDF；worker 僅檢查文件是否可結案，maintenance 可補救入列失敗。
    if (!result.repeated)
      await this.jobs.enqueueFinalization(result.documentId, result.signerId);
    const { documentId: _documentId, signerId: _signerId, ...view } = result;
    return view;
  }

  private normalizeReason(reason: RejectionDto['reason']): string {
    if (reason !== undefined && typeof reason !== 'string')
      throw new AppException(...AppErrors.ESIGN_REJECTION_REASON_INVALID);
    const normalized = reason?.trim() ?? '';
    if (Array.from(normalized).length > 200)
      throw new AppException(...AppErrors.ESIGN_REJECTION_REASON_INVALID);
    return normalized;
  }

  private async lockSigningContext(
    signerId: string,
    documentId: number | undefined,
    manager: EntityManager,
  ) {
    const document =
      documentId !== undefined
        ? await this.documents.findByIdForUpdate(documentId, manager)
        : null;
    const signer = document
      ? await this.signers.findByPublicIdForUpdate(signerId, manager)
      : null;
    if (!document || !signer)
      throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
    return { document, signer };
  }

  private checkSignerIdentity(
    document: EsignDocument,
    signer: EsignSigner,
    principal: SigningPrincipal,
  ): void {
    if (principal.kind === 'internal') {
      this.access.assertInternalSigner(document, signer, principal.userId);
      throw new AppException(...AppErrors.ESIGN_EMAIL_OTP_REQUIRED);
    }
    if (signer.id !== principal.signerId)
      throw new AppException(...AppErrors.ESIGN_EXTERNAL_SIGNER_MISMATCH);
    if (signer.invitationTokenSha256 !== principal.invitationGenerationSha256)
      throw new AppException(...AppErrors.ESIGN_EXTERNAL_UNAUTHORIZED);
    this.access.assertExternalAccess({ document, signer }, new Date());
  }

  private assertRejectionAllowed(
    document: EsignDocument,
    signer: EsignSigner,
  ): void {
    if (signer.status !== 'pending')
      throw new AppException(...AppErrors.ESIGN_REJECTION_CONFLICT);
    this.validation.assertActiveSigningWindow(document, new Date());
    if (!document.allowReject)
      throw new AppException(...AppErrors.ESIGN_REJECTION_NOT_ALLOWED);
  }

  private async saveRejection(
    signer: EsignSigner,
    principal: SigningPrincipal,
    requestId: string,
    reason: string,
    manager: EntityManager,
  ): Promise<void> {
    const now = new Date();
    signer.status = 'rejected';
    signer.rejectedAt = now;
    signer.rejectReason = reason;
    signer.rejectRequestId = requestId;
    signer.invitationTokenCiphertext = null;
    signer.invitationExpiresAt = null;
    await this.signers.save(signer, manager);
    await this.audit.append(
      {
        documentId: signer.documentId,
        signerId: signer.id,
        actorUserId:
          principal.kind === 'internal' ? principal.userId : undefined,
        eventType: 'signer.rejected',
        occurredAt: now,
        requestId,
        metadata: { reason },
      },
      manager,
    );
  }

  private async markDocumentFinalizing(
    document: EsignDocument,
    manager: EntityManager,
  ): Promise<void> {
    const counts = await this.signers.completionCounts(document.id, manager);
    if (counts.total > 0 && counts.pending === 0) {
      document.status = 'finalizing';
      await this.documents.save(document, manager);
    }
  }
}
