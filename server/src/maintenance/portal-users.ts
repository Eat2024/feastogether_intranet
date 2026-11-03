import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PortalUserSyncModule } from '#app/features/users/portal-user-sync.module';
import { PORTAL_USER_DEACTIVATION_LIMIT } from '#app/features/users/portal-user-sync.rules';
import { PortalUserSyncService } from '#app/features/users/services/portal-user-sync.service';
import { InfrastructureModule } from '#app/infrastructure/infrastructure.module';
import { RequestIdClsModule } from '#app/infrastructure/logging/requestId/request-id.module';
import { PORTAL_USERS_USAGE, parsePortalUsersArgs } from './portal-users.args';

/** 手動匯入只載入匯入服務與它需要的基礎設施；不含 worker 的 queue 與 scheduler。 */
@Module({
  imports: [RequestIdClsModule, InfrastructureModule, PortalUserSyncModule],
})
class PortalUserSyncCliModule {}

/**
 * 立即執行一次每日匯入，回傳結束碼。log 事件由 PortalUserSyncService 寫出，這裡只輸出到操作者終端機；
 * 被略過的員編只印在 stdout，不可寫進 log。匯入失敗的 PortalUserSyncError 不攔截，由 Node 以非零狀態結束。
 */
async function runPortalUsers(args: string[]): Promise<number> {
  const options = parsePortalUsersArgs(args);
  if (!options) {
    console.error(PORTAL_USERS_USAGE);
    return 1;
  }
  // 只留 error／warn，Nest 啟動訊息不混進給操作者看的輸出。
  const app = await NestFactory.createApplicationContext(
    PortalUserSyncCliModule,
    { logger: ['error', 'warn'] },
  );
  try {
    const { summary, skipped = [] } = await app
      .get(PortalUserSyncService)
      .run({ trigger: 'manual', ...options });
    console.log(`摘要：${JSON.stringify(summary)}`);
    for (const { empid, reason } of skipped) {
      console.log(`略過：${empid}（${reason}）`);
    }
    if (options.dryRun) console.log(`要停用：${summary.deactivated} 人`);
    if (summary.outcome !== 'blocked_deactivation_threshold') return 0;
    console.error(
      `停用 ${summary.deactivated} 人，超過門檻 ${PORTAL_USER_DEACTIVATION_LIMIT} 人，未寫入。` +
        `確認無誤後以 --allow-deactivations ${summary.deactivated} 重新執行。`,
    );
    return 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void runPortalUsers(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
