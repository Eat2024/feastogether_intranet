import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { NotificationRepository } from '#app/features/esign/repositories/notification.repository';
import { DocumentRepository } from '#app/features/esign/repositories/document.repository';
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
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const now = new Date();
    await this.expiry.reconcile(now);
    const staleBefore = new Date(now.getTime() - 5 * 60_000);
    const rows = await this.notifications.findEligibleInvitationLogIds(
      now,
      staleBefore,
      this.mysql.getManager(),
    );
    await Promise.all(
      rows.map((row) =>
        this.invitationQueue.add(
          ESIGN_EXTERNAL_INVITATION_JOB,
          { notificationLogId: Number(row.id) },
          { attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 },
        ),
      ),
    );
    const finalizations = await this.documents.findFinalizationCandidates(
      now,
      this.mysql.getManager(),
    );
    await Promise.all(
      finalizations.map((row) =>
        this.finalizationQueue.add(
          ESIGN_DOCUMENT_FINALIZATION_JOB,
          { documentId: Number(row.id) },
          { attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 },
        ),
      ),
    );
  }
}
