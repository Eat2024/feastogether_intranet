import type { Actor } from '#app/features/auth/auth.types';
import { markDocumentUpdated } from '../helpers/management-actor';
import { AppErrors } from '#app/common/errors/app-errors';
import { Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { DocumentRepository } from '../repositories/document.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';

@Injectable()
export class EsignStoppageService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly access: EsignAccessPolicyService,
    private readonly validation: EsignDocumentValidationService,
  ) {}

  stopByActor(documentId: number, actor: Actor, reason: string) {
    const normalized = reason.trim();
    if (normalized.length < 1 || normalized.length > 500) {
      throw new AppException(...AppErrors.ESIGN_STOP_REASON_INVALID);
    }
    return this.stop(documentId, normalized, new Date(), actor);
  }

  private async stop(
    documentId: number,
    reason: string,
    now: Date,
    actor: Actor,
  ) {
    await this.access.assertManagerNotInitiating(
      documentId,
      actor,
      this.mysql.getManager(),
    );
    return this.mysql.transaction(async (manager) => {
      const document = await this.access.lockManagedDocument(
        documentId,
        actor,
        manager,
      );
      await this.access.assertNotInitiating(documentId, manager);
      this.validation.assertActiveForStop(document);
      const signers = await this.signers.findByDocumentForUpdate(
        documentId,
        manager,
      );
      for (const signer of signers) {
        if (signer.status === 'pending') {
          signer.updatedByActorKind = actor.kind;
          signer.updatedByUserId =
            actor.kind === 'employee' ? actor.userId : null;
          signer.invitationTokenSha256 = null;
          signer.invitationTokenCiphertext = null;
          signer.invitationExpiresAt = null;
        }
      }
      await this.signers.saveMany(signers, manager);
      document.status = 'stopped';
      document.stoppedAt = now;
      document.stopReason = reason;
      markDocumentUpdated(document, actor);
      await this.documents.save(document, manager);
      return true;
    });
  }
}
