import type { PortalUserSyncOptions } from '#app/features/users/services/portal-user-sync.service';

export type PortalUsersOptions = Omit<PortalUserSyncOptions, 'trigger'>;

export const PORTAL_USERS_USAGE =
  '用法：node dist/maintenance/portal-users.js sync --dry-run | sync [--allow-deactivations <N>]';

/**
 * 只接受三種固定寫法（contracts「手動 CLI」）：`sync --dry-run`、`sync`、`sync --allow-deactivations <N>`。
 * 其他參數（含 023 的 --input、--output、--exclude-file、--acquired-at 與 rollback 指令）一律回傳 undefined。
 * 獨立成檔，讓單元測試不必載入 Nest 模組與環境變數驗證。
 */
export function parsePortalUsersArgs(
  args: string[],
): PortalUsersOptions | undefined {
  const [command, flag, value, ...rest] = args;
  if (command !== 'sync' || rest.length > 0) return undefined;
  if (flag === undefined) return { dryRun: false };
  if (flag === '--dry-run' && value === undefined) return { dryRun: true };
  if (flag === '--allow-deactivations' && /^\d+$/.test(value ?? ''))
    return { dryRun: false, confirmedDeactivations: Number(value) };
  return undefined;
}
