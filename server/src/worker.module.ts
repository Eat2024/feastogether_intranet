import { Module } from '@nestjs/common';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { RequestIdClsModule } from './infrastructure/logging/requestId/request-id.module';

/**
 * 背景工作進程的根模組。
 *
 * 目前只載入共用基礎設施；日後新增 queue processor 或 scheduler 時，
 * 建立專屬 worker module 並只在這裡註冊，避免 HTTP server 重複消費作業。
 */
@Module({
  imports: [RequestIdClsModule, InfrastructureModule],
})
export class WorkerModule {}
