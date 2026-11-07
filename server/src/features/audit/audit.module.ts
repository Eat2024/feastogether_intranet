import { Module } from '@nestjs/common';
import { MysqlModule } from '#app/infrastructure/database/mysql/mysql.module';
import { AuditLogService } from './services/audit-log.service';

@Module({
  imports: [MysqlModule],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
