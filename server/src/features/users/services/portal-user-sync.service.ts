import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { getErrorType } from '#app/infrastructure/logging/logHelper/error-type';
import { PortalDirectoryService } from '#app/infrastructure/portal/portal-directory.service';
import {
  findDepartedEmpids,
  isDeactivationBlocked,
  normalizePortalEmployees,
  planPortalUserSync,
  summarizePortalUserSync,
  type PortalUserSyncPlan,
  type PortalUserSyncSummary,
  type PortalUserSyncTrigger,
  type SkippedPortalEmployee,
} from '../portal-user-sync.rules';
import { UserRepository } from '../repositories/user.repository';

export interface PortalUserSyncOptions {
  trigger: PortalUserSyncTrigger;
  dryRun: boolean;
  /** 手動 CLI 的 --allow-deactivations：停用人數超過門檻時，必須等於本次停用人數才會套用。 */
  confirmedDeactivations?: number;
}

export interface PortalUserSyncResult {
  summary: PortalUserSyncSummary;
  /** 只在 dry-run 回傳，給 CLI 印到操作者終端機；不可寫進 log。 */
  skipped?: SkippedPortalEmployee[];
}

/**
 * 匯入失敗（Portal 讀取或本機寫入）。訊息只有失敗階段與錯誤類型：
 * 原始錯誤可能含 Portal 主機、帳號（mysql2 訊息）或員編（err.sql、唯一鍵衝突訊息），不可外流。
 */
export class PortalUserSyncError extends Error {
  constructor(
    readonly stage: 'source' | 'write',
    readonly errorType: string,
  ) {
    super(`Portal 員工主檔匯入失敗：${stage}（${errorType}）`);
    this.name = 'PortalUserSyncError';
  }
}

/** 標記來自 Portal 的錯誤，讓失敗分類成 source；其餘都是本機 DB 的 write。 */
class PortalSourceFailure extends Error {
  constructor(readonly original: unknown) {
    super('Portal 讀取失敗');
  }
}

const fromPortal = <T>(query: Promise<T>): Promise<T> =>
  query.catch((error: unknown) => {
    throw new PortalSourceFailure(error);
  });

/** mysql2／TypeORM 的錯誤代碼（如 ECONNREFUSED、ER_ACCESS_DENIED_ERROR）可區分故障類型，且不含設定值。 */
function errorTypeOf(error: unknown): string {
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : getErrorType(error);
}

/**
 * Portal 員工主檔匯入（research §6），worker 每日排程與手動 CLI 共用。
 * 先讀 Portal（交易外），再在單一交易中依 id 遞增鎖定本機資料、規劃並寫入；不讀寫任何檔案。
 */
@Injectable()
export class PortalUserSyncService {
  constructor(
    private readonly portal: PortalDirectoryService,
    private readonly users: UserRepository,
    private readonly mysql: MysqlService,
    private readonly logger: AppLoggerService,
  ) {}

  async run({
    trigger,
    dryRun,
    confirmedDeactivations,
  }: PortalUserSyncOptions): Promise<PortalUserSyncResult> {
    const sourceAcquiredAt = new Date().toISOString();
    try {
      const rows = await fromPortal(this.portal.listActiveEmployees());
      const source = normalizePortalEmployees(rows);

      // 本機在職、但不在 Portal 在職名單（含被略過的員編）中的人，才向 Portal 查狀態。
      const listed = new Set(rows.map((row) => row.person_empid));
      const candidates = (
        await this.users.findActiveCandidates(
          undefined,
          this.mysql.getManager(),
        )
      ).filter((user) => !listed.has(user.empid));
      const statuses = await fromPortal(
        this.portal.findStatusesByEmpids(candidates.map((user) => user.empid)),
      );
      const departedEmpids = findDepartedEmpids(statuses);
      const departed = candidates.filter((user) =>
        departedEmpids.has(user.empid),
      );

      const { plan, blocked } = await this.mysql.transaction(
        async (manager) => {
          // SQL 比對不分大小寫，所以也會取到只差大小寫的本機員編，供規劃判斷衝突。
          const matched = await this.users.findByEmpids(
            source.employees.map((employee) => employee.empid),
            manager,
          );
          const locked = await this.users.findByIdsWithEmail(
            [...matched, ...departed].map((user) => Number(user.id)),
            manager,
            true,
          );
          const plan = planPortalUserSync(
            source,
            locked,
            new Set(departed.map((user) => user.empid)),
          );
          const blocked = isDeactivationBlocked(plan, confirmedDeactivations);
          if (!dryRun && !blocked) await this.apply(plan, manager);
          return { plan, blocked };
        },
      );

      const summary = summarizePortalUserSync(plan, {
        trigger,
        sourceAcquiredAt,
        sourceRows: rows.length,
        outcome: dryRun
          ? 'dry_run'
          : blocked
            ? 'blocked_deactivation_threshold'
            : 'applied',
      });
      if (summary.outcome === 'blocked_deactivation_threshold') {
        this.logger.warn({
          event: 'portal_users.sync_blocked',
          context: PortalUserSyncService.name,
          metadata: { ...summary },
        });
      } else {
        this.logger.info({
          event: 'portal_users.sync_completed',
          context: PortalUserSyncService.name,
          metadata: { ...summary },
        });
      }
      return dryRun ? { summary, skipped: plan.skipped } : { summary };
    } catch (error) {
      const sourceFailed = error instanceof PortalSourceFailure;
      const stage = sourceFailed ? 'source' : 'write';
      const errorType = errorTypeOf(sourceFailed ? error.original : error);
      this.logger.error({
        event: 'portal_users.sync_failed',
        context: PortalUserSyncService.name,
        metadata: {
          trigger,
          sourceAcquiredAt,
          outcome: `failed_${stage}`,
          errorType,
        },
      });
      throw new PortalUserSyncError(stage, errorType);
    }
  }

  private async apply(
    plan: PortalUserSyncPlan,
    manager: EntityManager,
  ): Promise<void> {
    for (const operation of plan.operations) {
      if (operation.kind === 'create') {
        // Object.assign 讓 null 職稱寫入 NULL（entity 型別未含 null）。
        const user = this.users.create({ isActive: true }, manager);
        await this.users.save(Object.assign(user, operation.fields), manager);
      } else if (operation.kind === 'update') {
        await this.users.save(
          Object.assign(operation.user, operation.fields),
          manager,
        );
      } else if (operation.kind === 'deactivate') {
        operation.user.isActive = false;
        await this.users.save(operation.user, manager);
      }
    }
  }
}
