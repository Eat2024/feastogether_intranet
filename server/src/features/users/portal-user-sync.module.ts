import { Module } from '@nestjs/common';
import { MysqlModule } from '#app/infrastructure/database/mysql/mysql.module';
import { PortalModule } from '#app/infrastructure/portal/portal.module';
import { PortalUserSyncService } from './services/portal-user-sync.service';

/**
 * Portal 員工主檔匯入，給 worker 排程與手動 CLI 共用。
 * AppLoggerService 來自 InfrastructureModule 的全域 LoggingModule，使用端須一併載入 InfrastructureModule。
 */
@Module({
  imports: [MysqlModule, PortalModule],
  providers: [PortalUserSyncService],
  exports: [PortalUserSyncService],
})
export class PortalUserSyncModule {}
