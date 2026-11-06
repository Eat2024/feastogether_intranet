import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import type { SuperUserAccess } from '../entities/super-user-access.entity';
import {
  latestDueRotationPeriod,
  nextRotationPeriod,
} from '../helpers/rotation-period';
import { SuperUserAccessRepository } from '../repositories/super-user-access.repository';
import { AuthSecurityEventService } from './auth-security-event.service';
import {
  SUPER_USER_NOT_CONFIGURED,
  SuperUserConfigService,
} from './super-user-config.service';

export interface CurrentEntry {
  path: string;
  entryGeneration: number;
  rotatedAt: Date;
  /** 目前入口預定輪換的時間；早於現在代表輪換逾期、尚待補做。 */
  nextScheduledAt: Date;
}

/** 只回版本與比對結果；帳號、hash 與 fingerprint 都不輸出。 */
export interface CredentialStatus {
  generation: number;
  localConfigMatches: boolean;
  activatedAt: Date;
}

/** 到期輪換的結果，也是 worker job 的回傳值；不含入口原值。 */
export type EntryRotationResult =
  | { status: 'rotated'; entryGeneration: number }
  | { status: 'not_due' }
  | { status: 'uninitialized' };

/** REPL 寫入的操作身分：不是員工，也不是 Super user 會話。 */
const OPERATOR = { kind: 'operator' } as const;

/** 維護入口與帳密啟用版本的初始化及唯讀查詢；由 REPL 明確呼叫，不在任何啟動流程寫入。 */
@Injectable()
export class SuperUserAccessService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly access: SuperUserAccessRepository,
    private readonly superUserConfig: SuperUserConfigService,
    private readonly events: AuthSecurityEventService,
  ) {}

  /**
   * 首次建立唯一入口（32 random bytes 的 base64url），並把本機帳密設定啟用為第 1 版；
   * 已處理週期記為最近一個已到期的週一台北 04:00。兩筆安全事件與入口同交易。
   * 以 singleton PK 仲裁：已初始化（含並發中先 commit 的一方）回 initialized=false，不覆寫。
   * 不先做鎖定讀取：表內無列時 REPEATABLE READ 的 FOR UPDATE 會取得 gap lock，並發初始化會 deadlock；
   * 直接 INSERT 只競爭同一 PK，維持預設隔離等級即可。不回傳入口；入口只由 currentEntry 揭露。
   */
  async initialize(): Promise<{ initialized: boolean }> {
    const fingerprint = this.superUserConfig.fingerprint;
    if (!fingerprint) throw new Error(SUPER_USER_NOT_CONFIGURED);
    const now = new Date();
    return this.mysql.transaction(async (manager) => {
      const initialized = await this.access.insertIfAbsent(
        {
          entryKey: randomBytes(32).toString('base64url'),
          entryGeneration: 1,
          rotatedAt: now,
          periodStartAt: latestDueRotationPeriod(now),
          activeCredentialFingerprint: fingerprint,
          credentialGeneration: 1,
          credentialActivatedAt: now,
        },
        manager,
      );
      if (initialized) {
        await this.events.append(
          {
            type: 'entry.initialized',
            actor: OPERATOR,
            outcome: 'succeeded',
            entryGeneration: 1,
          },
          manager,
        );
        await this.events.append(
          {
            type: 'credentials.activated',
            actor: OPERATOR,
            outcome: 'succeeded',
            credentialGeneration: 1,
          },
          manager,
        );
      }
      return { initialized };
    });
  }

  /** 唯讀；唯一回傳入口原值的管道。path 對應前端隱藏登入頁，不猜測 origin。 */
  async currentEntry(): Promise<CurrentEntry> {
    const access = await this.findInitialized();
    return {
      path: `/ops-access/${access.entryKey}`,
      entryGeneration: access.entryGeneration,
      rotatedAt: access.rotatedAt,
      nextScheduledAt: nextRotationPeriod(access.periodStartAt),
    };
  }

  /** 唯讀；診斷本機設定是否等於 DB 已啟用的帳密版本。 */
  async credentialStatus(): Promise<CredentialStatus> {
    const access = await this.findInitialized();
    return {
      generation: access.credentialGeneration,
      localConfigMatches:
        access.activeCredentialFingerprint === this.superUserConfig.fingerprint,
      activatedAt: access.credentialActivatedAt,
    };
  }

  /**
   * 最近到期的週一台北 04:00 晚於 DB 已處理週期才換新入口；worker 排程、worker 啟動補做與 REPL 共用。
   * 先鎖 singleton，與登入交易內的入口重驗及其他輪換排隊；同一週期再執行（重試、重啟、多 worker）都是 no-op，
   * 停機錯過多週也只補一次。新入口、entry generation +1 與事件同交易 commit，失敗時整筆 rollback、保留舊入口。
   * 不改帳密版本、不撤會話；未初始化不建立任何列。不回傳入口；入口只由 currentEntry 揭露。
   */
  async rotateEntryIfDue(actor: {
    kind: 'operator' | 'system';
  }): Promise<EntryRotationResult> {
    const now = new Date();
    const period = latestDueRotationPeriod(now);
    return this.mysql.transaction(async (manager) => {
      const access = await this.access.findForUpdate(manager);
      if (!access) return { status: 'uninitialized' };
      if (period <= access.periodStartAt) return { status: 'not_due' };
      access.entryKey = randomBytes(32).toString('base64url');
      access.entryGeneration += 1;
      access.rotatedAt = now;
      access.periodStartAt = period;
      await this.access.save(access, manager);
      await this.events.append(
        {
          type: 'entry.rotated',
          actor,
          outcome: 'succeeded',
          entryGeneration: access.entryGeneration,
        },
        manager,
      );
      return { status: 'rotated', entryGeneration: access.entryGeneration };
    });
  }

  /** 尚未初始化時明確回 503，查詢不隱式初始化。 */
  private async findInitialized(): Promise<SuperUserAccess> {
    const access = await this.access.find(this.mysql.getManager());
    if (!access) {
      throw new AppException(...AppErrors.AUTH_SUPER_USER_UNAVAILABLE);
    }
    return access;
  }
}
