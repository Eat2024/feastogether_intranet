import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { TAIPEI_TIME_ZONE_ID } from '#app/common/date-time.helper';
import {
  AUTH_ACCESS_MAINTENANCE_QUEUE,
  SUPER_USER_ENTRY_ROTATION_JOB,
} from './super-user-access.constants';
import { SuperUserAccessProcessor } from './super-user-access.processor';

const SCHEDULER_ID = 'super-user-entry-weekly';

/**
 * 每週一台北 04:00 輪換維護入口。每個 worker 都 upsert 同一個 scheduler id，Redis 只有一份排程；
 * 是否到期一律由 DB 已處理週期裁決，Redis 排程遺失也不會失去週期。
 */
@Injectable()
export class SuperUserAccessScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(AUTH_ACCESS_MAINTENANCE_QUEUE) private readonly queue: Queue,
    private readonly rotation: SuperUserAccessProcessor,
  ) {}

  async onModuleInit(): Promise<void> {
    // 先以 DB 補做停機期間錯過的週期（停機多週也只換一次）；DB 不可用時讓 worker 啟動失敗。
    await this.rotation.process();
    // 已到期但尚未執行的那一次不覆寫（BullMQ 覆寫會刪掉它、改排下一次），與 Portal 每日匯入相同；
    // 它執行時由 DB 週期判定為 no-op，job 紀錄仍保留錯過的觸發與延遲。
    const next = (await this.queue.getJobScheduler(SCHEDULER_ID))?.next;
    if (next && next <= Date.now()) return;
    await this.queue.upsertJobScheduler(
      SCHEDULER_ID,
      { pattern: '0 4 * * 1', tz: TAIPEI_TIME_ZONE_ID },
      {
        name: SUPER_USER_ENTRY_ROTATION_JOB,
        data: {},
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      },
    );
  }
}
