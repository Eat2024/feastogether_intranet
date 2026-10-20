import { DocumentExportProcessor } from './document-export.processor';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { NotificationRepository } from '#app/features/esign/repositories/notification.repository';
import { DocumentRepository } from '#app/features/esign/repositories/document.repository';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { DocumentFinalizationProcessor } from './document-finalization.processor';
import { EsignExpiryService } from '#app/features/esign/services/esign-expiry.service';
import {
  ESIGN_DOCUMENT_FINALIZATION_JOB,
  ESIGN_DOCUMENT_FINALIZATION_QUEUE,
  ESIGN_EXTERNAL_INVITATION_JOB,
  ESIGN_EXTERNAL_INVITATION_QUEUE,
  ESIGN_MAINTENANCE_QUEUE,
} from '#app/features/esign/esign-queue.constants';

@Processor(ESIGN_MAINTENANCE_QUEUE)
export class EsignMaintenanceProcessor extends WorkerHost {
  constructor(
    private readonly mysql: MysqlService,
    private readonly notifications: NotificationRepository,
    private readonly documents: DocumentRepository,
    private readonly expiry: EsignExpiryService,
    @InjectQueue(ESIGN_EXTERNAL_INVITATION_QUEUE)
    private readonly invitationQueue: Queue,
    @InjectQueue(ESIGN_DOCUMENT_FINALIZATION_QUEUE)
    private readonly finalizationQueue: Queue,
    private readonly signers: SignerRepository,
    private readonly finalization: DocumentFinalizationProcessor,
    private readonly exports: DocumentExportProcessor,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const now = new Date();
    await this.exports.maintain(now);
    await this.expiry.reconcile(now);
    const staleBefore = new Date(now.getTime() - 5 * 60_000);
    const manager = this.mysql.getManager();
    let afterId = 0;
    while (true) {
      const rows = await this.notifications.findEligibleInvitationLogIds(
        now,
        staleBefore,
        manager,
        afterId,
      );
      if (rows.length === 0) break;
      await Promise.all(
        rows.map((row) =>
          this.invitationQueue.add(
            ESIGN_EXTERNAL_INVITATION_JOB,
            { notificationLogId: Number(row.id) },
            {
              attempts: 1,
              removeOnComplete: 1000,
              removeOnFail: 1000,
              deduplication: { id: `invitation-${Number(row.id)}` },
            },
          ),
        ),
      );
      afterId = Number(rows[rows.length - 1].id);
    }
    afterId = 0;
    while (true) {
      const rows = await this.signers.findCompletionCandidates(
        now,
        afterId,
        manager,
      );
      if (rows.length === 0) break;
      await Promise.all(
        rows.map((row) =>
          this.finalizationQueue.add(
            ESIGN_DOCUMENT_FINALIZATION_JOB,
            { documentId: Number(row.documentId), signerId: Number(row.id) },
            {
              attempts: 1,
              removeOnComplete: 1000,
              removeOnFail: 1000,
              deduplication: {
                id: `copy-${Number(row.documentId)}-${Number(row.id)}`,
              },
            },
          ),
        ),
      );
      afterId = Number(rows[rows.length - 1].id);
    }
    afterId = 0;
    let failures = 0;
    while (true) {
      const rows = await this.documents.findFinalizationCandidates(
        afterId,
        manager,
      );
      if (rows.length === 0) break;
      for (const row of rows) {
        try {
          await this.finalization.finalizeDocument(Number(row.id));
        } catch {
          failures += 1;
        }
      }
      afterId = Number(rows[rows.length - 1].id);
    }
    if (failures) throw new Error('部分文件結案失敗，將由下次維護重試');
  }
}
