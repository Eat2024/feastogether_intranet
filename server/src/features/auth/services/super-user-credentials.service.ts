import { Injectable } from '@nestjs/common';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { AuthSessionRepository } from '../repositories/auth-session.repository';
import { SuperUserAccessRepository } from '../repositories/super-user-access.repository';
import { AuthSecurityEventService } from './auth-security-event.service';
import {
  SUPER_USER_NOT_CONFIGURED,
  SuperUserConfigService,
} from './super-user-config.service';

/**
 * 明確啟用本機 Super user 帳密設定。只由 REPL 呼叫；HTTP／worker／REPL 啟動都不寫入，
 * 避免舊設定的實例開機時把 DB 啟用版本改回去。
 */
@Injectable()
export class SuperUserCredentialsService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly access: SuperUserAccessRepository,
    private readonly sessions: AuthSessionRepository,
    private readonly superUserConfig: SuperUserConfigService,
    private readonly events: AuthSecurityEventService,
  ) {}

  /**
   * 以操作者看到的 expectedGeneration 做 CAS，啟用本機已驗格式的設定；commit 即為生效點。
   * 本機設定已是啟用版本時 no-op；否則 generation+1（再啟用先前的設定也一樣），並在同一交易撤銷全部
   * active 維護會話、寫 credentials.activated。鎖序與登入相同：singleton → 會話。
   */
  async activate({
    expectedGeneration,
  }: {
    expectedGeneration: number;
  }): Promise<{ activated: boolean }> {
    const fingerprint = this.superUserConfig.fingerprint;
    if (!fingerprint) throw new Error(SUPER_USER_NOT_CONFIGURED);
    return this.mysql.transaction(async (manager) => {
      const access = await this.access.findForUpdate(manager);
      // 取得鎖後才取時間：等鎖期間先 commit 的登入，其會話不會晚於生效時間。
      const now = new Date();
      if (!access) {
        throw new AppException(...AppErrors.AUTH_SUPER_USER_UNAVAILABLE);
      }
      if (access.credentialGeneration !== expectedGeneration) {
        throw new AppException(
          ...AppErrors.AUTH_SUPER_USER_GENERATION_CONFLICT,
        );
      }
      if (access.activeCredentialFingerprint === fingerprint) {
        return { activated: false };
      }
      access.activeCredentialFingerprint = fingerprint;
      access.credentialGeneration = expectedGeneration + 1;
      access.credentialActivatedAt = now;
      await this.access.save(access, manager);
      await this.sessions.revokeActiveSuperUser(now, manager);
      await this.events.append(
        {
          type: 'credentials.activated',
          actor: { kind: 'operator' },
          outcome: 'succeeded',
          credentialGeneration: access.credentialGeneration,
        },
        manager,
      );
      return { activated: true };
    });
  }
}
