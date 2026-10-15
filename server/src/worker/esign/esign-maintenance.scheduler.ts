import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  ESIGN_MAINTENANCE_JOB,
  ESIGN_MAINTENANCE_QUEUE,
} from '#app/features/esign/esign-queue.constants';

@Injectable()
export class EsignMaintenanceScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(ESIGN_MAINTENANCE_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'esign-maintenance:30s',
      { every: 30_000 },
      { name: ESIGN_MAINTENANCE_JOB, data: {} },
    );
  }
}
