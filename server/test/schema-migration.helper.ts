import type { DataSource } from 'typeorm';

/** 最後一支已套用 migration 的名稱；尚未套用任何 migration 時為 undefined。 */
export async function lastMigrationName(
  ds: DataSource,
): Promise<string | undefined> {
  const rows = await ds.query<Array<{ name: string }>>(
    'SELECT name FROM migrations ORDER BY id DESC LIMIT 1',
  );
  return rows[0]?.name;
}

/** 後續 migration 增加時，舊資料測試仍在其指定版本執行。 */
export async function revertAfter(
  ds: DataSource,
  migration: string,
): Promise<void> {
  while (true) {
    const name = await lastMigrationName(ds);
    if (name === migration) return;
    if (!name) throw new Error(`找不到測試 migration：${migration}`);
    await ds.undoLastMigration();
  }
}
