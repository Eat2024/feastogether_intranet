import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';

// 新 feature module 於此註冊。AuthModule 目前保留原始碼，但尚未啟用。
@Module({
  imports: [HealthModule],
  exports: [HealthModule],
})
export class FeatureModule {}
