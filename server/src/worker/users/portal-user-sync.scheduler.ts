import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { TAIPEI_TIME_ZONE_ID } from '#app/common/date-time.helper';
import {
  PORTAL_USER_SYNC_JOB,
  PORTAL_USER_SYNC_QUEUE,
} from './portal-user-sync.constants';

const SCHEDULER_ID = 'portal-user-sync:daily';

/** 每天台北 04:00 匯入 Portal 員工主檔。每個 worker 都 upsert 同一個 scheduler id，Redis 只有一份排程。 */
@Injectable()
export class PortalUserSyncScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(PORTAL_USER_SYNC_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // BullMQ 覆寫既有排程時，會刪掉還沒執行的那一次 job、改排下一個 04:00。
    // worker 停機錯過 04:00 時，那一次已到期但仍在 Redis：這時不覆寫，讓 worker 補跑一次；
    // 開始執行時 BullMQ 會從當下排下一個 04:00，不會補跑多次。
    // 排程不存在時，BullMQ 對含冒號的 id 回傳 next 為 null 的物件。
    const next = (await this.queue.getJobScheduler(SCHEDULER_ID))?.next;
    if (next && next <= Date.now()) return;
    await this.queue.upsertJobScheduler(
      SCHEDULER_ID,
      { pattern: '0 4 * * *', tz: TAIPEI_TIME_ZONE_ID },
      {
        name: PORTAL_USER_SYNC_JOB,
        data: {},
        opts: { attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 },
      },
    );
  }
}
