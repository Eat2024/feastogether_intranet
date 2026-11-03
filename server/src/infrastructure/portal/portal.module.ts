import { Module } from '@nestjs/common';
import { PortalConfig } from './portal.config';
import { PortalDirectoryService } from './portal-directory.service';

/**
 * Portal 唯讀連線。由需要的 feature module 自行 import（不放進 InfrastructureModule），
 * 沒用到 Portal 的 process 就不帶這個設定依賴；Nest 只會建立一個實例，所以每個 process 一個連線池。
 */
@Module({
  providers: [PortalConfig, PortalDirectoryService],
  exports: [PortalConfig, PortalDirectoryService],
})
export class PortalModule {}
