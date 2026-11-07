import { AuthorizationModule } from '#app/features/authorization/authorization.module';
import { MysqlModule } from '#app/infrastructure/database/mysql/mysql.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClsModule } from 'nestjs-cls';
import { SuperUserAccessModule } from '#app/features/auth/super-user-access.module';
import { LoggingModule } from '#app/infrastructure/logging/logging.module';

/**
 * 維運 REPL 的窄 context：只有設定、CLS、logging 與維護入口服務（經由它載入 MysqlModule）。
 * 不載入 AppModule、WorkerModule 或完整 InfrastructureModule，因此沒有 HTTP、queue consumer、
 * 排程、mail、storage 或 Redis，也沒有任何啟動寫入；Portal 只在明確預指派時才連線。
 */
@Module({
  imports: [
    // 與 HTTP／worker 相同從 server/.env 載入，已設定的程序環境變數優先。
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ClsModule.forRoot({ global: true }),
    LoggingModule,
    SuperUserAccessModule,
    MysqlModule,
    AuthorizationModule,
  ],
})
export class ConsoleModule {}
