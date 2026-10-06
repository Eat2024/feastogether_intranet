import { Module } from '@nestjs/common';
import { FeatureModule } from './features/feature.module';
import { FrameworkModule } from './framework/framework.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';

@Module({
  imports: [InfrastructureModule, FrameworkModule, FeatureModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
