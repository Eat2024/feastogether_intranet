import { notificationStatus } from './notification-status';
import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import {
  NotificationBatchDto,
  NotificationListDto,
  NotificationPageDto,
} from '../dto/notification-batch.dto';
import { EsignNotificationBatch } from '../entities/esign-notification-batch.entity';
import { DocumentRepository } from '../repositories/document.repository';
import { NotificationRepository } from '../repositories/notification.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignJobProducerService } from './esign-job-producer.service';
import { EsignTokenService } from './esign-token.service';
import { reminderEligibility } from './esign-reminder-policy';

@Injectable()
export class EsignReminderService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly notifications: NotificationRepository,
    private readonly access: EsignAccessPolicyService,
    private readonly tokens: EsignTokenService,
    private readonly jobs: EsignJobProducerService,
  ) {}

  async create(
    documentId: number,
    userId: number,
    input: NotificationBatchDto,
  ) {
    if (
      input.selection === 'all_pending' &&
      input.signerPublicIds !== undefined
    )
      throw new AppException(...AppErrors.ESIGN_REMINDER_SELECTION_INVALID);
    const ids = [...new Set(input.signerPublicIds ?? [])].sort();
    const hash = createHash('sha256')
      .update(JSON.stringify({ selection: input.selection, ids }))
      .digest('hex');
    const result = await this.mysql.transaction(async (manager) => {
      const document = await this.documents.findByIdForUpdate(
        documentId,
        manager,
      );
      this.access.checkEsignCreator(document, userId);
      const previous = await this.notifications.findBatchRequest(
        documentId,
        userId,
        input.requestId,
        manager,
      );
      if (previous) {
        if (previous.requestPayloadSha256 !== hash)
          throw new AppException(...AppErrors.ESIGN_REMINDER_REQUEST_CONFLICT);
        return {
          view: await this.view(previous, manager),
          logIds: [] as number[],
          batchIds: [] as number[],
        };
      }
      const all = await this.signers.findByDocument(documentId, manager);
      const selected =
        input.selection === 'all_pending'
          ? all.filter((s) => s.status === 'pending')
          : all.filter((s) => ids.includes(s.publicId));
      if (input.selection === 'selected' && selected.length !== ids.length)
        throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
      // document → signer id 遞增；與簽署／停止共享鎖序。
      selected.sort((a, b) => a.id - b.id);
      const now = new Date();
      const history = await this.notifications.findBySignerIds(
        selected.map((s) => s.id),
        manager,
      );
      const targets: Array<{
        signer: NonNullable<
          Awaited<ReturnType<SignerRepository['findByIdForUpdate']>>
        >;
        reason: string | null;
      }> = [];
      for (const candidate of selected) {
        const signer = await this.signers.findByIdForUpdate(
          candidate.id,
          manager,
        );
        if (!signer)
          throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
        targets.push({
          signer,
          reason: reminderEligibility(
            document,
            signer,
            history.filter((l) => l.signerId === signer.id),
            now,
          ),
        });
      }
      const allInternalWithoutEmail =
        targets.length > 0 &&
        targets.every(
          (target) =>
            target.signer.signerType === 'user' &&
            target.reason === 'RECIPIENT_UNAVAILABLE',
        );
      if (!targets.some((t) => t.reason === null) && !allInternalWithoutEmail)
        throw new AppException(
          ...AppErrors.ESIGN_NO_ELIGIBLE_REMINDER_RECIPIENTS,
          {
            items: targets.map(({ signer, reason }) => ({
              signerPublicId: signer.publicId,
              reasonCode: reason,
            })),
          },
        );
      const batch = await this.notifications.saveBatch(
        this.notifications.createBatch(
          {
            publicId: randomUUID(),
            kind: 'reminder',
            documentId,
            notifiedByUserId: userId,
            requestId: input.requestId,
            requestPayloadSha256: hash,
            filterType: input.selection,
            targetCount: targets.length,
          },
          manager,
        ),
        manager,
      );
      const logs = await this.notifications.saveLogs(
        targets.map(({ signer, reason }) => {
          const token =
            reason || signer.signerType === 'user'
              ? null
              : this.tokens.createInvitationToken();
          return this.notifications.createLog(
            {
              batchId: batch.id,
              signerId: signer.id,
              channel: 'email',
              result: reason ? 'skipped' : 'pending',
              errorCode: reason,
              attemptCount: 0,
              reminderTokenSha256: token?.digest ?? null,
              reminderTokenCiphertext: token?.ciphertext ?? null,
              invitationGenerationSha256:
                signer.signerType === 'email'
                  ? signer.invitationTokenSha256
                  : null,
              reminderExpiresAt:
                signer.signerType === 'email' ? document.signEndAt : null,
              completedAt: reason ? now : undefined,
              attemptHistoryJson: [
                {
                  status: reason ? 'skipped' : 'pending',
                  at: now.toISOString(),
                  reasonCode: reason,
                },
              ],
            },
            manager,
          );
        }),
        manager,
      );
      const internalSignerIds = new Set(
        targets
          .filter((target) => target.signer.signerType === 'user')
          .map((target) => target.signer.id),
      );
      return {
        view: await this.view(batch, manager),
        logIds: logs
          .filter(
            (log) =>
              log.result === 'pending' && !internalSignerIds.has(log.signerId),
          )
          .map((log) => log.id),
        batchIds: logs.some(
          (log) =>
            log.result === 'pending' && internalSignerIds.has(log.signerId),
        )
          ? [batch.id]
          : [],
      };
    });
    await this.jobs.enqueueInvitations(result.logIds, result.batchIds);
    return result.view;
  }

  async list(documentId: number, userId: number, page: NotificationListDto) {
    const manager = this.mysql.getManager();
    this.access.checkEsignCreator(
      await this.documents.findById(documentId, manager),
      userId,
    );
    const batches = await this.notifications.listBatches(
      documentId,
      manager,
      page.limit,
      page.cursor,
      page.kind,
    );
    return {
      items: await Promise.all(
        batches
          .slice(0, page.limit)
          .map((batch) => this.summary(batch, manager)),
      ),
      nextCursor:
        batches.length > page.limit ? String(batches[page.limit - 1].id) : null,
    };
  }

  async detail(
    documentId: number,
    userId: number,
    batchId: string,
    page = new NotificationPageDto(),
  ) {
    const manager = this.mysql.getManager();
    this.access.checkEsignCreator(
      await this.documents.findById(documentId, manager),
      userId,
    );
    const batch = await this.notifications.findBatchPublic(
      documentId,
      batchId,
      manager,
    );
    if (!batch) throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
    return this.view(batch, manager, page);
  }

  private async summary(batch: EsignNotificationBatch, manager: EntityManager) {
    const counts = await this.notifications.batchCounts(batch.id, manager);
    return {
      batchId: batch.publicId,
      kind: batch.kind,
      requestedBy: batch.notifiedByUserId
        ? {
            userId: String(batch.notifiedByUserId),
            name: batch.notifiedByUser?.name ?? '員工',
          }
        : null,
      status: notificationStatus(counts),
      selectedCount: batch.targetCount,
      queuedCount: Object.entries(counts).reduce(
        (sum, [status, count]) => sum + (status === 'skipped' ? 0 : count),
        0,
      ),
      notSentCount: counts.skipped ?? 0,
      createdAt: batch.createdAt.toISOString(),
    };
  }

  private async view(
    batch: EsignNotificationBatch,
    manager: EntityManager,
    page = new NotificationPageDto(),
  ) {
    // 重新取得操作者關聯，使 POST／重送／GET 的內容一致。
    const hydrated = await this.notifications.findBatchPublic(
      batch.documentId,
      batch.publicId,
      manager,
    );
    const logs = await this.notifications.pageBatchLogs(
      batch.id,
      manager,
      page.limit,
      page.cursor,
    );
    return {
      ...(await this.summary(hydrated ?? batch, manager)),
      items: logs.slice(0, page.limit).map((l) => ({
        signerPublicId: l.signer?.publicId,
        name: l.signer?.nameSnapshot,
        status: l.result,
        reasonCode: l.errorCode ?? null,
        attemptCount: l.attemptCount,
        completedAt: l.completedAt?.toISOString() ?? null,
        attemptHistory: (l.attemptHistoryJson ?? []).map((attempt) => ({
          status: attempt.status,
          at: attempt.at,
          reasonCode: attempt.reasonCode ?? null,
        })),
      })),
      nextCursor:
        logs.length > page.limit ? String(logs[page.limit - 1].id) : null,
    };
  }
}
