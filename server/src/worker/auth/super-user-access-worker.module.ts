import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SuperUserAccessModule } from '#app/features/auth/super-user-access.module';
import { BullRootModule } from '#app/infrastructure/bullmq/bull-root.module';
import { AUTH_ACCESS_MAINTENANCE_QUEUE } from './super-user-access.constants';
import { SuperUserAccessProcessor } from './super-user-access.processor';
import { SuperUserAccessScheduler } from './super-user-access.scheduler';

/** 每週維護入口輪換的 queue、排程與 processor；只由 WorkerModule 載入，HTTP app 與 REPL 不註冊這個 queue。 */
@Module({
  imports: [
    SuperUserAccessModule,
    BullRootModule.register('worker'),
    BullModule.registerQueue({ name: AUTH_ACCESS_MAINTENANCE_QUEUE }),
  ],
  providers: [SuperUserAccessScheduler, SuperUserAccessProcessor],
})
export class SuperUserAccessWorkerModule {}
