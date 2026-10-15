import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateAppEnvironment } from '#app/config/app.environment';
import { MysqlModule } from './database/mysql/mysql.module';
import { FileStorageModule } from './file-storage/file-storage.module';
import { LoggingModule } from './logging/logging.module';
import { MailModule } from './mail/mail.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateAppEnvironment,
    }),
    LoggingModule,
    MysqlModule,
    FileStorageModule,
    MailModule,
  ],
  exports: [LoggingModule, MysqlModule, FileStorageModule, MailModule],
})
export class InfrastructureModule {}
