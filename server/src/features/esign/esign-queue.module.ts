import { type DynamicModule, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BullRootModule } from '#app/infrastructure/bullmq/bull-root.module';
import {
  ESIGN_DOCUMENT_FINALIZATION_QUEUE,
  ESIGN_EXTERNAL_INVITATION_QUEUE,
  ESIGN_MAINTENANCE_QUEUE,
} from './esign-queue.constants';

/** 僅註冊 queue producer；processor 與 scheduler 必須留在 worker module。 */
@Module({})
export class EsignQueueModule {
  static register(role: 'producer' | 'worker'): DynamicModule {
    return {
      module: EsignQueueModule,
      imports: [
        BullRootModule.register(role),
        BullModule.registerQueue(
          { name: ESIGN_EXTERNAL_INVITATION_QUEUE },
          { name: ESIGN_DOCUMENT_FINALIZATION_QUEUE },
          { name: ESIGN_MAINTENANCE_QUEUE },
        ),
      ],
      exports: [BullModule],
    };
  }
}
