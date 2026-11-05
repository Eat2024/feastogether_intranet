import { Injectable } from '@nestjs/common';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import type { IssuedSession } from '../auth.types';
import type { SuperUserLoginDto } from '../dto/super-user-login.dto';
import { isCurrentSuperUserEntry } from '../helpers/super-user-entry';
import { SuperUserAccessRepository } from '../repositories/super-user-access.repository';
import { AuthSecurityEventService } from './auth-security-event.service';
import { SessionService } from './session.service';
import { SuperUserConfigService } from './super-user-config.service';

/** 隱藏入口的位置預檢與 Super user 帳密登入。 */
@Injectable()
export class SuperUserLoginService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly access: SuperUserAccessRepository,
    private readonly superUserConfig: SuperUserConfigService,
    private readonly events: AuthSecurityEventService,
    private readonly sessions: SessionService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * 只讀 singleton 比對入口，不寫 DB。尚未初始化回 503；無效或舊入口回統一 404，
   * 只記安全 log（不寫事件表，避免猜測無限寫入），log 不含入口值。
   */
  async assertEntry(entryKey: string): Promise<void> {
    const access = await this.access.find(this.mysql.getManager()).catch(() => {
      throw new AppException(...AppErrors.AUTH_DB_UNAVAILABLE);
    });
    if (!access) {
      throw new AppException(...AppErrors.AUTH_SUPER_USER_UNAVAILABLE);
    }
    if (!isCurrentSuperUserEntry(entryKey, access.entryKey)) {
      this.logger.warn({
        context: SuperUserLoginService.name,
        event: 'auth.super_user_entry_rejected',
        message: '維護入口不存在或已失效',
      });
      throw new AppException(...AppErrors.HTTP_NOT_FOUND);
    }
  }

  /**
   * 帳密原樣交給 KDF（錯帳號也跑同一次）。錯誤時記匿名 login.rejected 並回統一 401，
   * 不碰目前會話；正確時由 SessionService 鎖 singleton 重驗入口與版本後原子替換。
   */
  async login(
    entryKey: string,
    { account, password }: SuperUserLoginDto,
    currentToken: string | null,
  ): Promise<IssuedSession> {
    if (!(await this.superUserConfig.verify(account, password))) {
      await this.events.recordRejection({
        type: 'login.rejected',
        actor: { kind: 'anonymous' },
        outcome: 'credentials_invalid',
      });
      throw new AppException(...AppErrors.AUTH_SUPER_USER_CREDENTIALS_INVALID);
    }
    return this.sessions.replace(currentToken, {
      kind: 'super_user',
      entryKey,
    });
  }
}
