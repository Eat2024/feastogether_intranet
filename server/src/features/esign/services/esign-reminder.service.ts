import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { NotificationBatchDto } from '../dto/notification-batch.dto';
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
        };
      }
      const all = await this.signers.findByDocument(documentId, manager);
      const selected =
        input.selection === 'all_pending'
          ? all.filter(
              (s) => s.signerType === 'email' && s.status === 'pending',
            )
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
          reason:
            reminderEligibility(
              document,
              signer,
              history.filter((l) => l.signerId === signer.id),
              now,
            ) ??
            (!signer.email || !signer.invitationTokenSha256
              ? 'NO_VALID_ADDRESS'
              : null),
        });
      }
      if (!targets.some((t) => t.reason === null))
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
          const token = reason ? null : this.tokens.createInvitationToken();
          return this.notifications.createLog(
            {
              batchId: batch.id,
              signerId: signer.id,
              channel: 'email',
              result: reason ? 'skipped' : 'pending',
              errorCode: reason,
              attemptCount: 0,
              reminderTokenSha256: token?.digest,
              reminderTokenCiphertext: token?.ciphertext,
              invitationGenerationSha256: signer.invitationTokenSha256,
              reminderExpiresAt: document.signEndAt,
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
      return {
        view: await this.view(batch, manager),
        logIds: logs.filter((l) => l.result === 'pending').map((l) => l.id),
      };
    });
    await this.jobs.enqueueInvitations(result.logIds);
    return result.view;
  }

  async detail(documentId: number, userId: number, batchId: string) {
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
    return this.view(batch, manager);
  }

  private async view(batch: EsignNotificationBatch, manager: EntityManager) {
    const logs = await this.notifications.findBatchLogs(batch.id, manager);
    return {
      batchId: batch.publicId,
      kind: batch.kind,
      status: logs.some((l) => ['pending', 'processing'].includes(l.result))
        ? 'pending'
        : 'completed',
      selectedCount: batch.targetCount,
      queuedCount: logs.filter((l) => l.result !== 'skipped').length,
      notSentCount: logs.filter((l) => l.result === 'skipped').length,
      createdAt: batch.createdAt.toISOString(),
      items: logs.map((l) => ({
        signerPublicId: l.signer?.publicId,
        name: l.signer?.nameSnapshot,
        status: l.result,
        reasonCode: l.errorCode ?? null,
        attemptCount: l.attemptCount,
        completedAt: l.completedAt?.toISOString() ?? null,
        attemptHistory: l.attemptHistoryJson ?? [],
      })),
    };
  }
}
