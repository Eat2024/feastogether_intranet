import { Processor, WorkerHost } from '@nestjs/bullmq';
import { type OnApplicationBootstrap } from '@nestjs/common';
import { type Job } from 'bullmq';
import { ESIGN_DOCUMENT_INITIATION_QUEUE } from '#app/features/esign/esign-queue.constants';
import { EsignInitiationJobService } from '#app/features/esign/services/esign-initiation-job.service';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { EsignMaintenanceScheduler } from './esign-maintenance.scheduler';

@Processor(ESIGN_DOCUMENT_INITIATION_QUEUE, { concurrency: 1, autorun: false })
export class DocumentInitiationProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  constructor(
    private readonly jobs: EsignInitiationJobService,
    private readonly scheduler: EsignMaintenanceScheduler,
    private readonly logger: AppLoggerService,
  ) {
    super();
  }
  async onApplicationBootstrap(): Promise<void> {
    if (!(await this.scheduler.waitUntilReady())) return;
    // WorkerHost 在 bootstrap 才保證完成註冊；run 是長期 promise，不阻塞啟動。
    void this.worker.run().catch(() => {
      this.logger.error({
        event: 'esign.initiation_consumer_stopped',
        message: '背景發起 consumer 已停止',
      });
    });
  }
  async process(job: Job<{ jobId: number }>): Promise<void> {
    // 斷線前已在途的 fetch 不一定受 pause 影響。未配置完成時不進 DB claim，
    // 此 delivery 結束後由恢復的 maintenance 重新補列 DB queued 工作。
    if (!this.scheduler.ready) return;
    if (!Number.isSafeInteger(job.data.jobId) || job.data.jobId < 1) return;
    await this.jobs.process(job.data.jobId);
  }
}
