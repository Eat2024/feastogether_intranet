import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { type OnModuleInit } from '@nestjs/common';
import { type Job, type Queue } from 'bullmq';
import { ESIGN_DOCUMENT_INITIATION_QUEUE } from '#app/features/esign/esign-queue.constants';
import { EsignInitiationJobService } from '#app/features/esign/services/esign-initiation-job.service';

@Processor(ESIGN_DOCUMENT_INITIATION_QUEUE, { concurrency: 1 })
export class DocumentInitiationProcessor
  extends WorkerHost
  implements OnModuleInit
{
  constructor(
    private readonly jobs: EsignInitiationJobService,
    @InjectQueue(ESIGN_DOCUMENT_INITIATION_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }
  async onModuleInit(): Promise<void> {
    await this.queue.setGlobalConcurrency(1);
  }
  async process(job: Job<{ jobId: number }>): Promise<void> {
    if (!Number.isSafeInteger(job.data.jobId) || job.data.jobId < 1) return;
    await this.jobs.process(job.data.jobId);
  }
}
