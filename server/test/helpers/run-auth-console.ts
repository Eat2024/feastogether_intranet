import { HttpException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AppException } from '#app/common/errors/app.exception';
import { ConsoleModule } from '#app/console/console.module';
import { createAuthConsole } from '#app/console/repl';

/**
 * 以獨立程序、依目前環境變數的 Super user 設定執行一個 REPL `auth` helper，供雙實例測試扮演
 * 「載入某組設定的維運 REPL」。與 repl.ts 相同只建立 ConsoleModule context，結束時關閉連線。
 *
 * 用法：node --conditions=development -r ts-node/register test/helpers/run-auth-console.ts <helper> [JSON 參數]
 * stdout 最後一行為 JSON：成功 `{"result":…}`；AppException 轉成 `{"error":{"code","status"}}`，
 * 讓呼叫端斷言錯誤碼；其他錯誤照常讓程序失敗。
 */
async function main(): Promise<void> {
  const [name, input] = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(ConsoleModule, {
    logger: false,
  });
  try {
    const auth = createAuthConsole(app) as unknown as Record<
      string,
      (arg?: unknown) => Promise<unknown>
    >;
    const result = await auth[name](
      input === undefined ? undefined : JSON.parse(input),
    );
    process.stdout.write(`${JSON.stringify({ result })}\n`);
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    const { code } = error as AppException;
    process.stdout.write(
      `${JSON.stringify({ error: { code, status: error.getStatus() } })}\n`,
    );
  } finally {
    await app.close();
  }
}

void main();
