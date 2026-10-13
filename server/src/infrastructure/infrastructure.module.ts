import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MysqlModule } from './database/mysql/mysql.module';
import { LoggingModule } from './logging/logging.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    LoggingModule,
    MysqlModule,
  ],
  exports: [LoggingModule, MysqlModule],
})
export class InfrastructureModule {}
