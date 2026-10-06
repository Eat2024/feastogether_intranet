// dump-schema.ts — 把目前資料庫的表結構匯出成 schema.sql（只有結構、不含資料）。
// schema.sql 是給人閱讀與 code review 的參考快照；建庫一律走 migration（pnpm db:setup），
// 不要直接匯入 schema.sql。新增 migration 並套用後重跑本指令，連同 migration 一起提交。
//
// CLI：pnpm -C server schema:dump（需本機有 mysqldump，MySQL 8 client）
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';

const OUTPUT_PATH = join(__dirname, 'schema.sql');

const HEADER = `-- 由 \`pnpm -C server schema:dump\` 自動產生，請勿手動修改。
-- 表結構以 migration（src/infrastructure/database/migrations）為準；本檔僅供閱讀與 review，
-- 建庫請用 \`pnpm -C server db:setup\`，不要直接匯入本檔。
`;

/**
 * 整理 mysqldump 輸出：拿掉 AUTO_INCREMENT 計數（隨資料變動，會造成無意義的 diff），
 * 並加上檔頭說明。
 */
export function normalizeSchemaDump(raw: string): string {
  const body = raw.replace(/ AUTO_INCREMENT=\d+/g, '').trimEnd();
  return `${HEADER}\n${body}\n`;
}

function dumpSchema(): string {
  const options = buildMysqlOptions() as MysqlConnectionOptions;
  const database = String(options.database);
  const args = [
    '--no-data',
    '--skip-comments',
    '--skip-dump-date',
    '--no-tablespaces',
    '--column-statistics=0',
    // TypeORM 的 migration 執行紀錄表不是應用程式的 schema
    `--ignore-table=${database}.migrations`,
    '-h',
    String(options.host),
    '-P',
    String(options.port),
    '-u',
    String(options.username),
    database,
  ];
  // 密碼走環境變數，不放在命令列參數（避免出現在 process 列表）
  const result = spawnSync('mysqldump', args, {
    encoding: 'utf8',
    env: { ...process.env, MYSQL_PWD: String(options.password ?? '') },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(
      `[schema:dump] 無法執行 mysqldump（請安裝 MySQL 8 client 並加入 PATH）：${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(`[schema:dump] mysqldump 失敗：${result.stderr.trim()}`);
  }
  return result.stdout;
}

if (require.main === module) {
  try {
    writeFileSync(OUTPUT_PATH, normalizeSchemaDump(dumpSchema()), 'utf8');
    console.log(`[schema:dump] 已輸出：${OUTPUT_PATH}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
