import { randomUUID } from 'node:crypto';
import { isDefinitelyUnsent } from '#app/infrastructure/mail/mail-delivery-outcome';
import { EsignNotificationLog } from '#app/features/esign/entities/esign-notification-log.entity';
import {
  reminderEligibility,
  taipeiDispatchDate,
} from '#app/features/esign/services/esign-reminder-policy';
import { Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
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

interface InvitationJobData {
  notificationLogId: number;
}

interface ClaimedInvitation {
  signerId: number;
  signerPublicId: string;
  documentId: number;
  recipientEmail: string;
  documentTitle: string;
  creatorName: string;
  signEndAt: Date;
  token: string;
  claimedAt: Date;
  generation: string;
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
    const claim = await this.claimInvitation(id);
    if (!claim) return;
    if ('reminder' in claim) return this.processReminder(id);

    try {
      await this.sendInvitation(claim);
    } catch {
      await this.finishFailed(id, claim);
      return;
    }

    await this.finishDelivered(id, claim);
  }

  private async claimInvitation(
    id: number,
  ): Promise<ClaimedInvitation | { reminder: true } | null> {
    const now = new Date();
    return this.mysql.transaction(async (manager) => {
      const log = await this.notifications.findInvitationContextForUpdate(
        id,
        manager,
      );
      if (log?.batch?.kind === 'reminder') return { reminder: true } as const;
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
        !['user', 'email'].includes(signer.signerType) ||
        !signer.email ||
        !signer.invitationTokenSha256 ||
        log.invitationGenerationSha256 !== signer.invitationTokenSha256 ||
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
        signerId: signer.id,
        signerPublicId: signer.publicId,
        documentId: document.id,
        recipientEmail: signer.email,
        documentTitle: document.title,
        creatorName: creator.name,
        signEndAt: document.signEndAt,
        token: this.tokens.decrypt(signer.invitationTokenCiphertext),
        claimedAt: now,
        generation: signer.invitationTokenSha256,
      };
    });
  }

  private async sendInvitation(claim: ClaimedInvitation): Promise<void> {
    await this.mailer.send({
      recipientEmail: claim.recipientEmail,
      documentTitle: claim.documentTitle,
      creatorName: claim.creatorName,
      signEndAt: claim.signEndAt,
      invitationToken: claim.token,
    });
  }

  private async finishDelivered(
    id: number,
    claim: ClaimedInvitation,
  ): Promise<void> {
    await this.mysql.transaction(async (manager) => {
      const document = await this.notifications.lockDocument(
        claim.documentId,
        manager,
      );
      const log = await this.notifications.findLogByIdForUpdate(id, manager);
      if (
        !log ||
        log.result !== 'processing' ||
        log.invitationGenerationSha256 !== claim.generation ||
        log.processingStartedAt?.getTime() !== claim.claimedAt.getTime()
      ) {
        return;
      }
      const signer = await this.signers.findByPublicIdForUpdate(
        claim.signerPublicId,
        manager,
      );
      if (
        !signer ||
        signer.id !== claim.signerId ||
        signer.invitationTokenSha256 !== claim.generation
      )
        return;
      const completedAt = new Date();
      if (
        document?.status !== 'active' ||
        !document.signEndAt ||
        completedAt >= document.signEndAt ||
        signer.status !== 'pending' ||
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

  /** 催簽使用獨立憑證；未知 SMTP 結果不自動重寄。 */
  private async processReminder(id: number): Promise<void> {
    const claim = await this.mysql.transaction(async (manager) => {
      const now = new Date();
      const log = await this.notifications.findInvitationContextForUpdate(
        id,
        manager,
      );
      if (!log || log.batch?.kind !== 'reminder') return null;
      if (log.result === 'processing') {
        if (
          log.processingStartedAt &&
          log.processingStartedAt.getTime() < now.getTime() - 5 * 60_000
        ) {
          log.result = 'unknown';
          log.errorCode = 'DELIVERY_OUTCOME_UNKNOWN';
          log.completedAt = now;
          log.processingStartedAt = null;
          log.leaseToken = null;
          log.nextAttemptAt = null;
          log.reminderTokenCiphertext = null;
          this.recordAttempt(log, now);
          await this.notifications.saveLog(log, manager);
        }
        return null;
      }
      if (
        !['pending', 'failed'].includes(log.result) ||
        log.attemptCount >= 3 ||
        (log.nextAttemptAt && log.nextAttemptAt > now)
      )
        return null;
      const signer = log.signer;
      const document = signer?.document;
      if (!signer || !document) return null;
      const history = await this.notifications.findBySignerIds(
        [signer.id],
        manager,
      );
      const reason =
        reminderEligibility(
          document,
          signer,
          history.filter((other) => other.id !== log.id),
          now,
        ) ??
        (log.invitationGenerationSha256 !== signer.invitationTokenSha256
          ? 'INVITATION_GENERATION_CHANGED'
          : null) ??
        (!log.reminderExpiresAt ||
        now >= log.reminderExpiresAt ||
        !log.reminderTokenCiphertext ||
        !signer.email
          ? 'INVITATION_EXPIRED'
          : null);
      if (reason) {
        log.result = 'skipped';
        log.errorCode = reason;
        log.completedAt = now;
        log.reminderTokenCiphertext = null;
        log.nextAttemptAt = null;
        this.recordAttempt(log, now);
        await this.notifications.saveLog(log, manager);
        return null;
      }
      // 明文僅留在 worker 記憶體，先解密才宣告已開始 SMTP。
      let token: string;
      try {
        token = this.tokens.decrypt(log.reminderTokenCiphertext!);
      } catch {
        log.result = 'skipped';
        log.errorCode = 'INVITATION_CREDENTIAL_UNAVAILABLE';
        log.completedAt = now;
        log.reminderTokenCiphertext = null;
        log.nextAttemptAt = null;
        this.recordAttempt(log, now);
        await this.notifications.saveLog(log, manager);
        return null;
      }
      log.result = 'processing';
      log.attemptCount += 1;
      log.processingStartedAt = now;
      log.dispatchDate = taipeiDispatchDate(now);
      log.leaseToken = randomUUID();
      log.errorCode = null;
      this.recordAttempt(log, now);
      await this.notifications.saveLog(log, manager);
      return {
        lease: log.leaseToken,
        token,
        documentId: document.id,
        signerId: signer.id,
        recipientEmail: signer.email!,
        documentTitle: document.title,
        creatorName: document.createdByUser?.name ?? '',
        signEndAt: document.signEndAt!,
      };
    });
    if (!claim) return;
    let outcome: 'delivered' | 'failed' | 'unknown' = 'delivered';
    try {
      await this.mailer.send({
        recipientEmail: claim.recipientEmail,
        documentTitle: claim.documentTitle,
        creatorName: claim.creatorName,
        signEndAt: claim.signEndAt,
        invitationToken: claim.token,
        kind: 'reminder',
      });
    } catch (error) {
      outcome = isDefinitelyUnsent(error) ? 'failed' : 'unknown';
    }
    await this.mysql.transaction(async (manager) => {
      const log = await this.notifications.findInvitationContextForUpdate(
        id,
        manager,
      );
      if (!log || log.result !== 'processing' || log.leaseToken !== claim.lease)
        return;
      const now = new Date();
      log.result = outcome;
      log.errorCode =
        outcome === 'delivered'
          ? null
          : outcome === 'failed'
            ? 'MAIL_NOT_ACCEPTED'
            : 'DELIVERY_OUTCOME_UNKNOWN';
      log.completedAt = now;
      log.processingStartedAt = null;
      log.leaseToken = null;
      log.nextAttemptAt =
        outcome === 'failed' && log.attemptCount < 3
          ? new Date(now.getTime() + 30_000 * 2 ** (log.attemptCount - 1))
          : null;
      if (!log.nextAttemptAt) log.reminderTokenCiphertext = null;
      this.recordAttempt(log, now);
      await this.notifications.saveLog(log, manager);
      // SMTP 已接受就是 delivered，不因隨後簽署／停止而改寫歷史。
      if (outcome === 'delivered')
        await this.audit.append(
          {
            documentId: claim.documentId,
            signerId: claim.signerId,
            eventType: 'external_reminder.delivered',
            occurredAt: now,
          },
          manager,
        );
    });
  }

  private recordAttempt(log: EsignNotificationLog, now: Date) {
    log.attemptHistoryJson = [
      ...(log.attemptHistoryJson ?? []),
      {
        status: log.result,
        at: now.toISOString(),
        reasonCode: log.errorCode ?? null,
      },
    ].slice(-10);
  }

  private async finishFailed(
    id: number,
    claim: ClaimedInvitation,
  ): Promise<void> {
    await this.mysql.transaction(async (manager) => {
      const log = await this.notifications.findInvitationContextForUpdate(
        id,
        manager,
      );
      if (
        !log ||
        log.result !== 'processing' ||
        log.processingStartedAt?.getTime() !== claim.claimedAt.getTime() ||
        log.invitationGenerationSha256 !== claim.generation ||
        log.signer?.invitationTokenSha256 !== claim.generation
      ) {
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
