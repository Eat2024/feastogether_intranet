import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MysqlModule } from './database/mysql/mysql.module';
import { RedisModule } from './database/redis/redis.module';
import { LoggingModule } from './logging/logging.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    LoggingModule,
    RedisModule,
    MysqlModule,
  ],
  exports: [LoggingModule, RedisModule, MysqlModule],
})
export class InfrastructureModule {}
