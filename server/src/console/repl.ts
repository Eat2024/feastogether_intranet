import { start } from 'node:repl';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AuthSecurityEventService } from '#app/features/auth/services/auth-security-event.service';
import { SuperUserAccessService } from '#app/features/auth/services/super-user-access.service';
import { ConsoleModule } from './console.module';

/**
 * REPL 唯一可用的 `auth` helpers。只放閉包，不放 service 本身：service 的欄位會帶出
 * MysqlService、DataSource 與 repository，等於開放裸 SQL 繞過業務規則。
 */
export function createAuthConsole(app: INestApplicationContext) {
  const access = app.get(SuperUserAccessService);
  const events = app.get(AuthSecurityEventService);
  return {
    initialize: () => access.initialize(),
    currentEntry: () => access.currentEntry(),
    credentialStatus: () => access.credentialStatus(),
    // 與 worker 同一個到期判斷；不接受參數，沒有任意時間強制換網址。
    rotateEntryIfDue: () => access.rotateEntryIfDue({ kind: 'operator' }),
    securityEvents: (options: { limit?: number; beforeId?: number } = {}) =>
      events.list(options),
  };
}

/**
 * 維運 REPL：`pnpm -C server repl:dev`（原始碼）或建置後 `pnpm -C server repl`。
 * 不用 @nestjs/core 的 repl()：它會把 context 內所有 provider token 與 get()／$() 放進 REPL，
 * 包括 DataSource 與 repository。程式化啟動的 node:repl 不寫 history 檔；
 * 結束時關閉 Nest context，一併銷毀 DB 連線池。
 */
async function bootstrap(): Promise<void> {
  // 只留 error／warn，Nest 啟動訊息不混進操作者的輸出。
  const app = await NestFactory.createApplicationContext(ConsoleModule, {
    logger: ['error', 'warn'],
  });
  const server = start();
  server.context.auth = createAuthConsole(app);
  server.on('exit', () => void app.close());
}

if (require.main === module) {
  void bootstrap();
}
