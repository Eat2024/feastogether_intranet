import {
  INTERNAL_PORTAL_LOGIN_URL,
  INTERNAL_NOTIFICATION_RECIPIENT_LIMIT,
} from '#app/features/esign/esign.constants';
import type { InternalMailRecipientResult } from '#app/infrastructure/mail/invitation-mail-sender.port';
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
  notificationLogId?: number;
  notificationBatchId?: number;
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
    const batchId = job.data?.notificationBatchId;
    if (
      typeof batchId === 'number' &&
      Number.isSafeInteger(batchId) &&
      batchId > 0
    )
      return this.processInternalBatch(batchId);
    const id = job.data?.notificationLogId;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return;
    const claim = await this.claimInvitation(id);
    if (!claim) return;
    if ('internalBatchId' in claim)
      return this.processInternalBatch(claim.internalBatchId);
    if ('reminder' in claim) return this.processReminder(id);

    try {
      await this.sendInvitation(claim);
    } catch {
      await this.finishFailed(id, claim);
      return;
    }

    await this.finishDelivered(id, claim);
  }

  private async processInternalBatch(batchId: number): Promise<void> {
    while (true) {
      const claim = await this.claimInternalGroup(batchId);
      if (!claim) return;
      let results: InternalMailRecipientResult[];
      try {
        results = await this.mailer.sendInternalGroup({
          recipientEmails: claim.emails,
          documentTitle: claim.documentTitle,
          creatorName: claim.creatorName,
          signEndAt: claim.signEndAt,
          kind: claim.kind,
          portalLoginUrl: INTERNAL_PORTAL_LOGIN_URL,
        });
      } catch {
        // adapter 無法確定結果時不盲目重寄。
        results = [];
      }
      // SMTP 後寫入失敗保留 processing；維護復原為 unknown，不能再發信。
      await this.mysql.transaction(async (manager) => {
        const context =
          await this.notifications.findInternalBatchContextForUpdate(
            batchId,
            manager,
          );
        if (!context) return;
        const now = new Date();
        const resultEmails = results.map((item) =>
          item.recipientEmail.trim().toLowerCase(),
        );
        if (
          resultEmails.some((email) => !claim.emails.includes(email)) ||
          claim.emails.some(
            (email) =>
              resultEmails.filter((value) => value === email).length !== 1,
          )
        ) {
          await this.audit.append(
            {
              documentId: context.document.id,
              eventType: 'internal_notification.protocol_error',
              occurredAt: now,
              metadata: { errorCode: 'MAIL_RESULT_MISMATCH' },
            },
            manager,
          );
        }
        for (const log of context.logs) {
          if (
            log.result !== 'processing' ||
            log.leaseToken !== claim.lease ||
            log.errorCode === 'INVITATION_SUPERSEDED'
          )
            continue;
          const email = log.signer?.email?.trim().toLowerCase();
          const matches = results.filter(
            (item) => item.recipientEmail.trim().toLowerCase() === email,
          );
          const result = matches.length === 1 ? matches[0] : undefined;
          log.result =
            result?.status === 'accepted'
              ? 'delivered'
              : result?.status === 'rejected'
                ? 'failed'
                : 'unknown';
          log.errorCode =
            log.result === 'delivered'
              ? null
              : log.result === 'failed'
                ? 'MAIL_NOT_ACCEPTED'
                : 'DELIVERY_OUTCOME_UNKNOWN';
          log.completedAt = now;
          log.processingStartedAt = null;
          log.leaseToken = null;
          log.nextAttemptAt =
            log.result === 'failed' && result?.retryable && log.attemptCount < 3
              ? new Date(now.getTime() + 30_000 * 2 ** (log.attemptCount - 1))
              : null;
          log.reminderTokenCiphertext = null;
          this.recordAttempt(log, now);
          await this.notifications.saveLog(log, manager);
          if (log.result === 'delivered' && log.signer) {
            log.signer.invitationDeliveredAt = now;
            await this.signers.save(log.signer, manager);
            await this.audit.append(
              {
                documentId: context.document.id,
                signerId: log.signerId,
                eventType:
                  context.batch.kind === 'reminder'
                    ? 'internal_reminder.delivered'
                    : 'internal_invitation.delivered',
                occurredAt: now,
              },
              manager,
            );
          }
        }
      });
    }
  }

  private async claimInternalGroup(batchId: number) {
    return this.mysql.transaction(async (manager) => {
      const context =
        await this.notifications.findInternalBatchContextForUpdate(
          batchId,
          manager,
        );
      if (!context) return null;
      const { document, batch, logs } = context;
      const now = new Date();
      const internal = logs.filter((log) => log.signer?.signerType === 'user');
      for (const log of internal) {
        if (log.errorCode === 'INVITATION_SUPERSEDED') continue;
        if (
          log.result === 'processing' &&
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
      }
      const groups = new Map<string, EsignNotificationLog[]>();
      for (const log of internal) {
        if (
          log.errorCode === 'INVITATION_SUPERSEDED' ||
          !['pending', 'failed'].includes(log.result) ||
          log.attemptCount >= 3 ||
          (log.result === 'failed' && !log.nextAttemptAt) ||
          (log.nextAttemptAt && log.nextAttemptAt > now)
        )
          continue;
        const email = log.signer?.email?.trim().toLowerCase();
        const reason = !email
          ? 'RECIPIENT_UNAVAILABLE'
          : document.status !== 'active' ||
              !document.signEndAt ||
              now >= document.signEndAt ||
              log.signer?.status !== 'pending'
            ? 'INVITATION_NO_LONGER_ACTIVE'
            : null;
        if (reason) {
          log.result = 'skipped';
          log.errorCode = reason;
          log.completedAt = now;
          log.nextAttemptAt = null;
          this.recordAttempt(log, now);
          await this.notifications.saveLog(log, manager);
          continue;
        }
        const group = groups.get(email!) ?? [];
        group.push(log);
        groups.set(email!, group);
      }
      // 歷史逐人工作可能留下同地址的不同狀態，已寄／未知者不可再次投遞。
      // 尚未投遞的明細誠實記為 skipped，避免 maintenance 永遠補入 pending。
      const blocked = new Set<string>();
      for (const [email, group] of groups) {
        const siblings = internal.filter(
          (log) => log.signer?.email?.trim().toLowerCase() === email,
        );
        const settled = siblings.find((log) =>
          ['delivered', 'unknown'].includes(log.result),
        );
        if (settled) {
          for (const log of group) {
            log.result = 'skipped';
            log.errorCode =
              settled.result === 'unknown'
                ? 'DELIVERY_OUTCOME_UNKNOWN'
                : 'RECIPIENT_ALREADY_NOTIFIED';
            log.completedAt = now;
            log.nextAttemptAt = null;
            this.recordAttempt(log, now);
            await this.notifications.saveLog(log, manager);
          }
          blocked.add(email);
        } else if (
          siblings.some(
            (log) =>
              log.result === 'processing' ||
              (log.result === 'failed' &&
                log.nextAttemptAt &&
                log.nextAttemptAt > now),
          )
        ) {
          blocked.add(email);
        }
      }
      // Map 插入順序沿明細 id；同地址全部一起領取。
      const emails = [...groups.keys()]
        .filter((email) => !blocked.has(email))
        .slice(0, INTERNAL_NOTIFICATION_RECIPIENT_LIMIT);
      if (!emails.length || !document.signEndAt) return null;
      const lease = randomUUID();
      for (const email of emails)
        for (const log of groups.get(email)!) {
          log.result = 'processing';
          log.attemptCount += 1;
          log.processingStartedAt = now;
          log.leaseToken = lease;
          log.errorCode = null;
          log.nextAttemptAt = null;
          log.dispatchDate = taipeiDispatchDate(now);
          this.recordAttempt(log, now);
          await this.notifications.saveLog(log, manager);
        }
      return {
        lease,
        emails,
        documentTitle: document.title,
        creatorName: document.createdByUser?.name ?? '',
        signEndAt: document.signEndAt,
        kind:
          batch.kind === 'reminder'
            ? ('reminder' as const)
            : ('invitation' as const),
      };
    });
  }

  private async claimInvitation(
    id: number,
  ): Promise<
    ClaimedInvitation | { reminder: true } | { internalBatchId: number } | null
  > {
    const now = new Date();
    return this.mysql.transaction(async (manager) => {
      const log = await this.notifications.findInvitationContextForUpdate(
        id,
        manager,
      );
      if (log?.errorCode === 'INVITATION_SUPERSEDED') return null;
      if (log?.signer?.signerType === 'user')
        return { internalBatchId: log.batchId };
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
        signer.signerType !== 'email' ||
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
      if (
        !log ||
        log.batch?.kind !== 'reminder' ||
        log.errorCode === 'INVITATION_SUPERSEDED'
      )
        return null;
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
