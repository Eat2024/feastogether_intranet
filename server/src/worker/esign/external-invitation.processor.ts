import { Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { EntityManager } from 'typeorm';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  INVITATION_MAIL_SENDER,
  type InvitationMailSender,
} from '#app/infrastructure/mail/invitation-mail-sender.port';
import { NotificationRepository } from '#app/features/esign/repositories/notification.repository';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { EsignAuditService } from '#app/features/esign/services/esign-audit.service';
import { EsignTokenService } from '#app/features/esign/services/esign-token.service';
import { ESIGN_EXTERNAL_INVITATION_QUEUE } from '#app/features/esign/esign-queue.constants';

interface InvitationClaim {
  documentId: number;
  signerId: number;
  signerPublicId: string;
  digest: string;
  claimedAt: Date;
}

interface InvitationJobData {
  notificationLogId: number;
}

@Processor(ESIGN_EXTERNAL_INVITATION_QUEUE)
export class ExternalInvitationProcessor extends WorkerHost {
  constructor(
    private readonly mysql: MysqlService,
    private readonly notifications: NotificationRepository,
    private readonly signers: SignerRepository,
    private readonly tokens: EsignTokenService,
    private readonly audit: EsignAuditService,
    @Inject(INVITATION_MAIL_SENDER)
    private readonly mailer: InvitationMailSender,
  ) {
    super();
  }

  async process(job: Job<InvitationJobData>): Promise<void> {
    // 只合併等待中的重複通知；開始處理後仍由 DB lease 與證據唯一約束決定結果。
    if (job.opts?.deduplication) await job.removeDeduplicationKey();
    const id = job.data?.notificationLogId;
    if (!Number.isSafeInteger(id) || id < 1) return;
    const now = new Date();
    const claim = await this.mysql.transaction(async (manager) => {
      const log = await this.notifications.findInvitationContextForUpdate(
        id,
        manager,
      );
      const stale =
        log?.result === 'processing' &&
        log.processingStartedAt != null &&
        log.processingStartedAt.getTime() < now.getTime() - 5 * 60_000;
      const eligible =
        log &&
        log.errorCode !== 'INVITATION_SUPERSEDED' &&
        ((['pending', 'failed'].includes(log.result) &&
          (!log.nextAttemptAt || log.nextAttemptAt <= now)) ||
          stale);
      const signer = log?.signer;
      const document = signer?.document;
      const creator = document?.createdByUser;
      if (
        !eligible ||
        !signer ||
        !document ||
        !creator ||
        signer.signerType !== 'email' ||
        !signer.email ||
        !signer.invitationTokenSha256 ||
        !signer.invitationTokenCiphertext ||
        !signer.invitationExpiresAt ||
        signer.status !== 'pending' ||
        document.status !== 'active' ||
        !document.signEndAt ||
        now >= signer.invitationExpiresAt ||
        now >= document.signEndAt
      ) {
        return null;
      }
      log.result = 'processing';
      log.attemptCount += 1;
      log.processingStartedAt = now;
      log.errorCode = null;
      await this.notifications.saveLog(log, manager);
      return {
        digest: signer.invitationTokenSha256,
        signerId: signer.id,
        signerPublicId: signer.publicId,
        documentId: document.id,
        recipientEmail: signer.email,
        documentTitle: document.title,
        creatorName: creator.name,
        signEndAt: document.signEndAt,
        token: this.tokens.decrypt(signer.invitationTokenCiphertext),
        claimedAt: now,
      };
    });
    if (!claim) return;

    try {
      await this.mailer.send({
        recipientEmail: claim.recipientEmail,
        documentTitle: claim.documentTitle,
        creatorName: claim.creatorName,
        signEndAt: claim.signEndAt,
        invitationToken: claim.token,
      });
    } catch {
      await this.finishFailed(id, claim);
      return;
    }

    await this.mysql.transaction(async (manager) => {
      const context = await this.lockCurrentClaim(id, claim, manager);
      if (!context) return;
      const { document, log, signer } = context;
      const completedAt = new Date();
      if (
        document?.status !== 'active' ||
        !document.signEndAt ||
        completedAt >= document.signEndAt ||
        signer.status !== 'pending' ||
        !signer.invitationTokenSha256 ||
        !signer.invitationTokenCiphertext ||
        !signer.invitationExpiresAt ||
        completedAt >= signer.invitationExpiresAt
      ) {
        log.result = 'failed';
        log.errorCode = 'INVITATION_NO_LONGER_ACTIVE';
        log.completedAt = completedAt;
        log.processingStartedAt = null;
        log.nextAttemptAt = null;
        await this.notifications.saveLog(log, manager);
        return;
      }
      log.result = 'delivered';
      log.completedAt = completedAt;
      log.processingStartedAt = null;
      log.nextAttemptAt = null;
      signer.invitationDeliveredAt = completedAt;
      signer.invitationTokenCiphertext = null;
      await this.notifications.saveLog(log, manager);
      await this.signers.save(signer, manager);
      await this.audit.append(
        {
          documentId: claim.documentId,
          signerId: signer.id,
          eventType: 'external_invitation.delivered',
          occurredAt: completedAt,
        },
        manager,
      );
    });
  }

  private async lockCurrentClaim(
    id: number,
    claim: InvitationClaim,
    manager: EntityManager,
  ) {
    const document = await this.notifications.lockDocument(
      claim.documentId,
      manager,
    );
    const log = await this.notifications.findLogByIdForUpdate(id, manager);
    if (
      !log ||
      log.result !== 'processing' ||
      log.processingStartedAt?.getTime() !== claim.claimedAt.getTime()
    ) {
      return null;
    }
    const signer = await this.signers.findByPublicIdForUpdate(
      claim.signerPublicId,
      manager,
    );
    if (
      !signer ||
      signer.id !== claim.signerId ||
      signer.invitationTokenSha256 !== claim.digest
    )
      return null;
    return { document, log, signer };
  }

  private async finishFailed(
    id: number,
    claim: InvitationClaim,
  ): Promise<void> {
    await this.mysql.transaction(async (manager) => {
      const context = await this.lockCurrentClaim(id, claim, manager);
      if (!context) return;
      const { document, log, signer } = context;
      const now = new Date();
      if (
        document?.status !== 'active' ||
        !document.signEndAt ||
        now >= document.signEndAt ||
        signer.status !== 'pending' ||
        !signer.invitationExpiresAt ||
        now >= signer.invitationExpiresAt
      ) {
        log.result = 'failed';
        log.errorCode = 'INVITATION_NO_LONGER_ACTIVE';
        log.completedAt = now;
        log.processingStartedAt = null;
        log.nextAttemptAt = null;
        await this.notifications.saveLog(log, manager);
        return;
      }
      log.result = 'failed';
      log.errorCode = 'MAIL_DELIVERY_FAILED';
      log.processingStartedAt = null;
      log.nextAttemptAt = new Date(
        Date.now() +
          Math.min(30 * 60_000, 30_000 * 2 ** (log.attemptCount - 1)),
      );
      await this.notifications.saveLog(log, manager);
    });
  }
}
