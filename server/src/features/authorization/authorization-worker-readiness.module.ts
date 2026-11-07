import { Module } from '@nestjs/common';
import { AuthorizationModule } from './authorization.module';
import { AuthorizationReadinessService } from './services/authorization-readiness.service';

/** async provider 在 InstanceLoader 階段完成，早於 Bull 與 scheduler 的 onModuleInit。 */
@Module({
  imports: [AuthorizationModule],
  providers: [
    {
      provide: 'AUTHORIZATION_WORKER_READY',
      inject: [AuthorizationReadinessService],
      useFactory: async (readiness: AuthorizationReadinessService) => {
        await readiness.assertReady();
        return true;
      },
    },
  ],
})
export class AuthorizationWorkerReadinessModule {}
