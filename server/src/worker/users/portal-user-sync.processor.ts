import { Processor, WorkerHost } from '@nestjs/bullmq';
import { PortalUserSyncService } from '#app/features/users/services/portal-user-sync.service';
import { PORTAL_USER_SYNC_QUEUE } from './portal-user-sync.constants';

/**
 * 每日排程的 Portal 員工主檔匯入。成功、超過門檻與失敗的 log 都由 PortalUserSyncService 寫出，這裡不重複記錄；
 * 失敗時 service 拋出的 PortalUserSyncError 訊息不含原始錯誤，可直接成為 job 的 failedReason。
 */
@Processor(PORTAL_USER_SYNC_QUEUE, { concurrency: 1 })
export class PortalUserSyncProcessor extends WorkerHost {
  constructor(private readonly sync: PortalUserSyncService) {
    super();
  }

  async process(): Promise<void> {
    await this.sync.run({ trigger: 'schedule', dryRun: false });
  }
}
