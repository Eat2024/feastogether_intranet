import { Module } from '@nestjs/common';
import { MysqlModule } from '#app/infrastructure/database/mysql/mysql.module';
import { AuthSecurityEventService } from './services/auth-security-event.service';
import { SuperUserAccessService } from './services/super-user-access.service';
import { SuperUserConfigService } from './services/super-user-config.service';
import { SuperUserCredentialsService } from './services/super-user-credentials.service';

/**
 * Super user 帳密設定、維護入口與安全事件的窄組合，HTTP AuthModule、維護 worker 與維運 REPL 共用。
 * 沒有 controller、APP_GUARD 或啟動寫入；Super user 帳密任一未設定時維護登入停用，hash 格式錯誤時建構即讓啟動失敗。
 */
@Module({
  imports: [MysqlModule],
  providers: [
    SuperUserConfigService,
    AuthSecurityEventService,
    SuperUserAccessService,
    SuperUserCredentialsService,
  ],
  exports: [
    SuperUserConfigService,
    AuthSecurityEventService,
    SuperUserAccessService,
  ],
})
export class SuperUserAccessModule {}
