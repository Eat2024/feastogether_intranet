import { AppErrors } from '#app/common/errors/app-errors';
import { Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { DocumentRepository } from '../repositories/document.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignAuditService } from './esign-audit.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';

@Injectable()
export class EsignStoppageService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly access: EsignAccessPolicyService,
    private readonly validation: EsignDocumentValidationService,
    private readonly audit: EsignAuditService,
  ) {}

  stopByCreator(documentId: number, creatorUserId: number, reason: string) {
    const normalized = reason.trim();
    if (normalized.length < 1 || normalized.length > 500) {
      throw new AppException(...AppErrors.ESIGN_STOP_REASON_INVALID);
    }
    return this.stop(documentId, normalized, new Date(), creatorUserId);
  }

  stopByDeadline(documentId: number, now: Date) {
    return this.stop(documentId, '簽署期限已到', now);
  }

  private stop(
    documentId: number,
    reason: string,
    now: Date,
    creatorUserId?: number,
  ) {
    return this.mysql.transaction(async (manager) => {
      const document = await this.documents.findByIdForUpdate(
        documentId,
        manager,
      );
      if (creatorUserId !== undefined)
        this.access.checkEsignCreator(document, creatorUserId);
      if (!document) return false;
      if (document.status === 'stopped' && creatorUserId === undefined)
        return false;
      if (creatorUserId === undefined && document.status !== 'active')
        return false;
      this.validation.assertActiveForStop(document);
      const signers = await this.signers.findByDocumentForUpdate(
        documentId,
        manager,
      );
      if (
        creatorUserId === undefined &&
        (!document.signEndAt ||
          now < document.signEndAt ||
          !signers.some((signer) => signer.status === 'pending'))
      ) {
        return false;
      }
      for (const signer of signers) {
        if (signer.status === 'pending') {
          signer.invitationTokenSha256 = null;
          signer.invitationTokenCiphertext = null;
          signer.invitationExpiresAt = null;
        }
      }
      await this.signers.saveMany(signers, manager);
      document.status = 'stopped';
      document.stoppedAt = now;
      document.stopReason = reason;
      await this.documents.save(document, manager);
      await this.audit.append(
        {
          documentId,
          actorUserId: creatorUserId,
          eventType:
            creatorUserId === undefined
              ? 'document.stopped_by_deadline'
              : 'document.stopped_by_creator',
          occurredAt: now,
          metadata: { status: 'stopped', reason },
        },
        manager,
      );
      return true;
    });
  }
}
