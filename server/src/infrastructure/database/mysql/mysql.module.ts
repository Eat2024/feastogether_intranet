// mysql.module.ts
import { Module } from '@nestjs/common';
import { MysqlLifecycleService } from './mysql-lifecycle.service';
import { MysqlProvider } from './mysql.provider';
import { MysqlService } from './mysql.service';

@Module({
  providers: [
    MysqlProvider,
    // app.close() 時銷毀連線池；MYSQL_MAIN 本身是普通物件，不會被 Nest 呼叫生命週期
    MysqlLifecycleService,
    MysqlService,
  ],
  exports: [MysqlProvider, MysqlService],
})
export class MysqlModule {}
