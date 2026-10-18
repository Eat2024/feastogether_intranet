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

const ENQUEUE_TIMEOUT_MS = 500;

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
      const queued = await this.bestEffort(
        this.invitationQueue.addBulk(
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
        ),
        'esign.invitation_enqueue_failed',
      );
      // Redis 失效時讓既有 maintenance 接續，避免累積未完成的連線請求。
      if (!queued) break;
    }
  }

  async enqueueFinalization(
    documentId: number,
    signerId: number,
  ): Promise<void> {
    await this.bestEffort(
      this.finalizationQueue.add(
        ESIGN_DOCUMENT_FINALIZATION_JOB,
        { documentId, signerId },
        {
          attempts: 1,
          removeOnComplete: 1000,
          removeOnFail: 1000,
          deduplication: { id: `copy-${documentId}-${signerId}` },
        },
      ),
      'esign.finalization_enqueue_failed',
    );
  }

  private async bestEffort(
    work: Promise<unknown>,
    event: string,
  ): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('queue timeout')),
            ENQUEUE_TIMEOUT_MS,
          );
        }),
      ]);
      return true;
    } catch {
      this.logger.warn({ event, context: EsignJobProducerService.name });
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
