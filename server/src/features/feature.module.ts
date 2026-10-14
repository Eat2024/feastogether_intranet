import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { EsignModule } from './esign/esign.module';

@Module({
  imports: [AuthModule, HealthModule, EsignModule],
  exports: [AuthModule, HealthModule, EsignModule],
})
export class FeatureModule {}
