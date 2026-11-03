import type { INestApplicationContext } from '@nestjs/common';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
/** 舊電子簽測試的 HR 系統邊界替身；只使用合成員編，不連正式來源。 */
export function syntheticStaffEmails(empids: readonly string[]) {
  return Promise.resolve(
    new Map(
      empids.map((empid) => [empid, `${empid.toLowerCase()}@example.test`]),
    ),
  );
}

/** 測試安排階段明確匯入指定合成員工信箱；不作 runtime fallback。 */
export async function seedSyntheticStaffEmails(
  app: INestApplicationContext,
  empids: readonly string[],
): Promise<void> {
  const manager = app.get(MysqlService).getManager();
  for (const empid of empids) {
    await manager.query('UPDATE users SET email=? WHERE empid=?', [
      `${empid.toLowerCase()}@example.test`,
      empid,
    ]);
  }
}
