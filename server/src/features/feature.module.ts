import { AuthorizationHttpModule } from './authorization/authorization-http.module';
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { EsignModule } from './esign/esign.module';

@Module({
  imports: [AuthModule, AuthorizationHttpModule, HealthModule, EsignModule],
  exports: [AuthModule, AuthorizationHttpModule, HealthModule, EsignModule],
})
export class FeatureModule {}
