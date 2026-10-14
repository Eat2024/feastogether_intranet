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
    await Promise.all(
      notificationLogIds.map((notificationLogId) =>
        this.bestEffort(
          this.invitationQueue.add(
            ESIGN_EXTERNAL_INVITATION_JOB,
            { notificationLogId },
            { attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 },
          ),
          'esign.invitation_enqueue_failed',
        ),
      ),
    );
  }

  enqueueFinalization(documentId: number): Promise<void> {
    return this.bestEffort(
      this.finalizationQueue.add(
        ESIGN_DOCUMENT_FINALIZATION_JOB,
        { documentId },
        { attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 },
      ),
      'esign.finalization_enqueue_failed',
    );
  }

  private async bestEffort(
    work: Promise<unknown>,
    event: string,
  ): Promise<void> {
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
    } catch {
      this.logger.warn({ event, context: EsignJobProducerService.name });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
