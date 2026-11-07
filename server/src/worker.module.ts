import { AuthorizationWorkerReadinessModule } from './features/authorization/authorization-worker-readiness.module';
import { Module } from '@nestjs/common';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { RequestIdClsModule } from './infrastructure/logging/requestId/request-id.module';
import { SuperUserAccessWorkerModule } from './worker/auth/super-user-access-worker.module';
import { EsignWorkerModule } from './worker/esign/esign-worker.module';
import { PortalUserSyncWorkerModule } from './worker/users/portal-user-sync-worker.module';

/**
 * 背景工作進程的根模組。
 *
 * queue processor 與 scheduler 放在各自的 worker module，只在這裡註冊，避免 HTTP server 重複消費作業或排程。
 */
@Module({
  imports: [
    RequestIdClsModule,
    InfrastructureModule,
    AuthorizationWorkerReadinessModule,
    EsignWorkerModule,
    PortalUserSyncWorkerModule,
    SuperUserAccessWorkerModule,
  ],
})
export class WorkerModule {}
