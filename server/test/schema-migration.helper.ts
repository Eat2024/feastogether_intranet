import type { DataSource } from 'typeorm';

/** 後續 migration 增加時，舊資料測試仍在其指定版本執行。 */
export async function revertAfter(
  ds: DataSource,
  migration: string,
): Promise<void> {
  while (true) {
    const rows = await ds.query<Array<{ name: string }>>(
      'SELECT name FROM migrations ORDER BY id DESC LIMIT 1',
    );
    if (rows[0]?.name === migration) return;
    if (!rows.length) throw new Error(`找不到測試 migration：${migration}`);
    await ds.undoLastMigration();
  }
}
