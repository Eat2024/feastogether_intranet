import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PortalUserSyncModule } from '#app/features/users/portal-user-sync.module';
import { BullRootModule } from '#app/infrastructure/bullmq/bull-root.module';
import { PORTAL_USER_SYNC_QUEUE } from './portal-user-sync.constants';
import { PortalUserSyncProcessor } from './portal-user-sync.processor';
import { PortalUserSyncScheduler } from './portal-user-sync.scheduler';

/** 每日 Portal 員工主檔匯入的 queue、排程與 processor；只由 WorkerModule 載入，HTTP app 不註冊這個 queue。 */
@Module({
  imports: [
    PortalUserSyncModule,
    BullRootModule.register('worker'),
    BullModule.registerQueue({ name: PORTAL_USER_SYNC_QUEUE }),
  ],
  providers: [PortalUserSyncScheduler, PortalUserSyncProcessor],
})
export class PortalUserSyncWorkerModule {}
