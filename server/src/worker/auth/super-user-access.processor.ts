import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  type EntryRotationResult,
  SuperUserAccessService,
} from '#app/features/auth/services/super-user-access.service';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { getErrorType } from '#app/infrastructure/logging/logHelper/error-type';
import { AUTH_ACCESS_MAINTENANCE_QUEUE } from './super-user-access.constants';

const SYSTEM = { kind: 'system' } as const;

/**
 * 輪換失敗的 job 原因只帶錯誤類型：原始 DB 錯誤可能夾帶 SQL 與參數（含尚未生效的新入口），
 * 不能進 Redis 的 failedReason 或 worker 啟動失敗輸出。
 */
export class SuperUserEntryRotationError extends Error {
  constructor(readonly errorType: string) {
    super(`維護入口輪換失敗（${errorType}）`);
    this.name = 'SuperUserEntryRotationError';
  }
}

/**
 * 每週入口輪換 job，也供 worker 啟動補做使用。到期與否由 DB 已處理週期裁決，
 * 重試、重啟、多 worker 或錯過的 job 一起執行都只換一次。結果成為 job 回傳值。
 */
@Processor(AUTH_ACCESS_MAINTENANCE_QUEUE)
export class SuperUserAccessProcessor extends WorkerHost {
  constructor(
    private readonly access: SuperUserAccessService,
    private readonly logger: AppLoggerService,
  ) {
    super();
  }

  async process(): Promise<EntryRotationResult> {
    let result: EntryRotationResult;
    try {
      result = await this.access.rotateEntryIfDue(SYSTEM);
    } catch (error) {
      // mysql2／TypeORM 的錯誤代碼（如 ECONNREFUSED）可區分故障類型，且不含入口或設定值。
      const { code } = error as { code?: unknown };
      const errorType = typeof code === 'string' ? code : getErrorType(error);
      this.logger.error({
        event: 'auth.entry_rotation_failed',
        context: SuperUserAccessProcessor.name,
        message: '維護入口輪換失敗，保留原入口',
        metadata: { errorType },
      });
      throw new SuperUserEntryRotationError(errorType);
    }
    if (result.status === 'uninitialized') {
      this.logger.warn({
        event: 'auth.entry_rotation_uninitialized',
        context: SuperUserAccessProcessor.name,
        message: '維護入口尚未初始化，未輪換；請以 REPL 執行 auth.initialize()',
      });
    }
    return result;
  }
}
