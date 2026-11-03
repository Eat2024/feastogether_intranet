import 'reflect-metadata';
import { PortalImportError } from './portal-users-source';
import { DataSource } from 'typeorm';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { previewPortalUsers, applyPortalUsers } from './portal-users-import';
import {
  previewPortalRollback,
  rollbackPortalUsers,
} from './portal-users-recovery';
import { readJson } from './portal-users-store';
import type { PortalExclusion } from './portal-users-source';

/** 人工維護入口；憑證由現有 DB 設定提供，不接受 CLI 密碼。 */
export async function runPortalUsers(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  const allowedByCommand: Record<string, string[]> = {
    preview: ['--input', '--output', '--exclude-file', '--acquired-at'],
    apply: ['--preview', '--output'],
    'rollback-preview': ['--result', '--output'],
    rollback: ['--preview'],
  };
  if (!Object.hasOwn(allowedByCommand, command))
    throw new PortalImportError(
      '請使用 preview、apply、rollback-preview 或 rollback',
    );
  const allowed = allowedByCommand[command];
  const options = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i],
      value = rest[i + 1];
    if (
      !allowed.includes(name) ||
      !value ||
      value.startsWith('--') ||
      options.has(name)
    )
      throw new PortalImportError('維護參數不合法');
    options.set(name, value);
  }
  const required = (name: string) => {
    const value = options.get(name);
    if (!value) throw new PortalImportError(`缺少必要參數 ${name}`);
    return value;
  };
  const output = command === 'rollback' ? undefined : required('--output');
  const input = required(
    command === 'preview'
      ? '--input'
      : command === 'rollback-preview'
        ? '--result'
        : '--preview',
  );
  const acquiredAt =
    command === 'preview' ? required('--acquired-at') : undefined;
  let exclusions: PortalExclusion[] = [];
  if (command === 'preview' && options.has('--exclude-file')) {
    const raw = await readJson(required('--exclude-file'));
    if (!Array.isArray(raw))
      throw new PortalImportError('排除名單必須是 JSON 陣列');
    exclusions = raw as PortalExclusion[];
  }
  const ds = await new DataSource(buildMysqlOptions()).initialize();
  try {
    const result =
      command === 'preview'
        ? await previewPortalUsers(ds, input, output!, acquiredAt!, exclusions)
        : command === 'apply'
          ? await applyPortalUsers(ds, input, output!)
          : command === 'rollback-preview'
            ? await previewPortalRollback(ds, input, output!)
            : await rollbackPortalUsers(ds, input);
    console.info(
      JSON.stringify({ batchId: result.batchId, summary: result.summary }),
    );
  } finally {
    await ds.destroy();
  }
}
if (require.main === module) {
  runPortalUsers(process.argv.slice(2)).catch((error: unknown) => {
    console.error(
      error instanceof PortalImportError
        ? error.message
        : '維護執行失敗，請檢查連線與受控批次檔；不輸出原始錯誤',
    );
    process.exitCode = 1;
  });
}
