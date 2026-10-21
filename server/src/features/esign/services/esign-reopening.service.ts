import { Injectable } from '@nestjs/common';
import { isEmail } from 'class-validator';
import type { EntityManager } from 'typeorm';
import type { EsignDocument } from '../entities/esign-document.entity';
import type { EsignSigner } from '../entities/esign-signer.entity';
import type { EsignNotificationLog } from '../entities/esign-notification-log.entity';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { DocumentRepository } from '../repositories/document.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { NotificationRepository } from '../repositories/notification.repository';
import type { ReopenDocumentDto } from '../dto/reopening.dto';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { EsignExpiryService } from './esign-expiry.service';
import { EsignTokenService } from './esign-token.service';
import { canonicalSha256, EsignAuditService } from './esign-audit.service';
import { EsignJobProducerService } from './esign-job-producer.service';

@Injectable()
export class EsignReopeningService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly notifications: NotificationRepository,
    private readonly policy: EsignAccessPolicyService,
    private readonly validation: EsignDocumentValidationService,
    private readonly expiry: EsignExpiryService,
    private readonly tokens: EsignTokenService,
    private readonly audit: EsignAuditService,
    private readonly jobs: EsignJobProducerService,
  ) {}

  async reopen(documentId: number, userId: number, input: ReopenDocumentDto) {
    const committed = await this.mysql.transaction(async (manager) => {
      const document = await this.documents.findByIdForUpdate(
        documentId,
        manager,
      );
      this.policy.checkEsignCreator(document, userId);
      const logs = await this.notifications.findByDocumentForUpdate(
        documentId,
        manager,
      );
      const signers = await this.signers.findByDocumentForUpdate(
        documentId,
        manager,
      );
      const now = new Date();
      const { previous, pending, next, reason } = this.validateReopening(
        document,
        signers,
        input,
        now,
      );
      const originalSignEndAt = this.validateOriginalPayload(document);
      const unavailable = pending.filter(
        (signer) =>
          !signer.email ||
          !isEmail(signer.email) ||
          !signer.invitationTokenSha256 ||
          !signer.invitationExpiresAt,
      );
      if (unavailable.length > 0)
        throw new AppException(
          ...AppErrors.ESIGN_REOPEN_RECIPIENT_UNAVAILABLE,
          {
            signerPublicIds: unavailable.map((signer) => signer.publicId),
          },
        );
      await this.expiry.expireLocked(document, signers, now, manager);
      await this.supersedeNotifications(logs, pending, now, manager);
      await this.rotatePendingInvitations(pending, next, manager);
      await this.saveReopenedDocument(
        document,
        userId,
        { previous, next, reason, now },
        manager,
      );
      const batch = await this.notifications.saveBatch(
        this.notifications.createBatch(
          {
            documentId,
            kind: 'invitation',
            filterType: 'external_invitation',
            targetCount: pending.length,
            notifiedByUserId: userId,
          },
          manager,
        ),
        manager,
      );
      const newLogs = await this.notifications.saveLogs(
        pending.map((signer) =>
          this.notifications.createLog(
            {
              batchId: batch.id,
              signerId: signer.id,
              channel: 'email',
              result: 'pending',
              attemptCount: 0,
              invitationGenerationSha256: signer.invitationTokenSha256,
              nextAttemptAt: now,
            },
            manager,
          ),
        ),
        manager,
      );
      return {
        notificationLogIds: newLogs.map((log) => log.id),
        result: {
          documentId: String(documentId),
          status: 'active',
          originalSignEndAt,
          signEndAt: next.toISOString(),
          isReopened: true,
          reopenedAt: now.toISOString(),
          pendingCount: pending.length,
        },
      };
    });
    await this.jobs.enqueueInvitations(committed.notificationLogIds);
    return committed.result;
  }

  private validateReopening(
    document: EsignDocument,
    signers: EsignSigner[],
    input: ReopenDocumentDto,
    now: Date,
  ) {
    const previous = document.signEndAt;
    if (
      !previous ||
      previous.getTime() !== Date.parse(input.expectedSignEndAt)
    ) {
      throw new AppException(...AppErrors.ESIGN_REOPEN_STALE);
    }
    const pending = signers.filter((signer) => signer.status === 'pending');
    if (
      !(
        document.status === 'expired' ||
        (document.status === 'active' && now >= previous)
      ) ||
      pending.length === 0
    ) {
      throw new AppException(...AppErrors.ESIGN_DOCUMENT_NOT_REOPENABLE);
    }
    const next = new Date(input.signEndAt);
    const reason = input.reason.trim();
    if (
      !Number.isFinite(next.getTime()) ||
      next <= now ||
      next <= previous ||
      Array.from(reason).length < 1 ||
      Array.from(reason).length > 500
    ) {
      throw new AppException(...AppErrors.ESIGN_REOPEN_INPUT_INVALID);
    }
    return { previous, pending, next, reason };
  }

  private validateOriginalPayload(document: EsignDocument): string {
    const payload = document.signingPayloadJson;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AppException(...AppErrors.ESIGN_INTEGRITY_FAILED);
    }
    this.validation.assertPayloadIntegrity(document, canonicalSha256(payload));
    const period = payload.period;
    if (
      !period ||
      typeof period !== 'object' ||
      Array.isArray(period) ||
      !('startAt' in period) ||
      !('endAt' in period) ||
      typeof period.startAt !== 'string' ||
      typeof period.endAt !== 'string' ||
      !Number.isFinite(Date.parse(period.startAt)) ||
      !Number.isFinite(Date.parse(period.endAt)) ||
      Date.parse(period.startAt) >= Date.parse(period.endAt)
    ) {
      throw new AppException(...AppErrors.ESIGN_INTEGRITY_FAILED);
    }
    return period.endAt;
  }

  private async supersedeNotifications(
    logs: EsignNotificationLog[],
    pending: EsignSigner[],
    now: Date,
    manager: EntityManager,
  ): Promise<void> {
    const pendingIds = new Set(pending.map((signer) => signer.id));
    const unfinished = logs.filter(
      (log) =>
        pendingIds.has(log.signerId) &&
        (['pending', 'processing'].includes(log.result) ||
          (log.result === 'failed' && log.nextAttemptAt != null)),
    );
    for (const log of unfinished) {
      log.result = 'failed';
      log.errorCode = 'INVITATION_SUPERSEDED';
      log.completedAt = now;
      log.processingStartedAt = null;
      log.nextAttemptAt = null;
      log.leaseToken = null;
      log.reminderTokenCiphertext = null;
    }
    if (unfinished.length > 0)
      await this.notifications.saveLogs(unfinished, manager);
  }

  private async rotatePendingInvitations(
    pending: EsignSigner[],
    next: Date,
    manager: EntityManager,
  ): Promise<void> {
    for (const signer of pending) {
      const invitation = this.tokens.createInvitationToken();
      signer.invitationTokenSha256 = invitation.digest;
      signer.invitationTokenCiphertext = invitation.ciphertext;
      signer.invitationExpiresAt = next;
      signer.invitationDeliveredAt = null;
    }
    await this.signers.saveMany(pending, manager);
  }

  private async saveReopenedDocument(
    document: EsignDocument,
    userId: number,
    change: { previous: Date; next: Date; reason: string; now: Date },
    manager: EntityManager,
  ): Promise<void> {
    const { previous, next, reason, now } = change;
    document.status = 'active';
    document.signEndAt = next;
    await this.documents.save(document, manager);
    await this.audit.append(
      {
        documentId: document.id,
        actorUserId: userId,
        eventType: 'document.reopened',
        occurredAt: now,
        metadata: {
          status: 'active',
          previousSignEndAt: previous.toISOString(),
          signEndAt: next.toISOString(),
          reason,
        },
      },
      manager,
    );
  }
}
