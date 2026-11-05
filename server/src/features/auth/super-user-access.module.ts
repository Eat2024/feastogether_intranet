import { Module } from '@nestjs/common';
import { MysqlModule } from '#app/infrastructure/database/mysql/mysql.module';
import { AuthSecurityEventService } from './services/auth-security-event.service';
import { SuperUserAccessService } from './services/super-user-access.service';
import { SuperUserConfigService } from './services/super-user-config.service';

/**
 * Super user 帳密設定、維護入口與安全事件的窄組合，HTTP AuthModule 與維運 REPL 共用。
 * 沒有 controller、APP_GUARD 或啟動寫入；缺少或不合法的 Super user 設定在建構時即讓啟動失敗。
 */
@Module({
  imports: [MysqlModule],
  providers: [
    SuperUserConfigService,
    AuthSecurityEventService,
    SuperUserAccessService,
  ],
  exports: [SuperUserConfigService, AuthSecurityEventService],
})
export class SuperUserAccessModule {}
