import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import {
  ESIGN_DOCUMENT_FINALIZATION_JOB,
  ESIGN_DOCUMENT_FINALIZATION_QUEUE,
  ESIGN_EXTERNAL_INVITATION_JOB,
  ESIGN_EXTERNAL_INVITATION_QUEUE,
} from '../esign-queue.constants';

@Injectable()
export class EsignJobProducerService {
  constructor(
    @InjectQueue(ESIGN_EXTERNAL_INVITATION_QUEUE)
    private readonly invitationQueue: Queue,
    @InjectQueue(ESIGN_DOCUMENT_FINALIZATION_QUEUE)
    private readonly finalizationQueue: Queue,
    private readonly logger: AppLoggerService,
  ) {}

  async enqueueInvitations(notificationLogIds: number[]): Promise<void> {
    for (let offset = 0; offset < notificationLogIds.length; offset += 100) {
      try {
        await this.invitationQueue.addBulk(
          notificationLogIds
            .slice(offset, offset + 100)
            .map((notificationLogId) => ({
              name: ESIGN_EXTERNAL_INVITATION_JOB,
              data: { notificationLogId },
              opts: {
                attempts: 1,
                removeOnComplete: 1000,
                removeOnFail: 1000,
                deduplication: { id: `invitation-${notificationLogId}` },
              },
            })),
        );
      } catch {
        this.logger.warn({
          event: 'esign.invitation_enqueue_failed',
          context: EsignJobProducerService.name,
        });
        // 已提交的通知紀錄由 maintenance 補送，停止後續批次。
        break;
      }
    }
  }

  async enqueueFinalization(
    documentId: number,
    signerId: number,
  ): Promise<void> {
    try {
      await this.finalizationQueue.add(
        ESIGN_DOCUMENT_FINALIZATION_JOB,
        { documentId, signerId },
        {
          attempts: 1,
          removeOnComplete: 1000,
          removeOnFail: 1000,
          deduplication: { id: `copy-${documentId}-${signerId}` },
        },
      );
    } catch {
      // 簽署已提交；保留 pending 由 maintenance 補入列，不回報簽署失敗。
      this.logger.warn({
        event: 'esign.finalization_enqueue_failed',
        context: EsignJobProducerService.name,
      });
    }
  }
}
