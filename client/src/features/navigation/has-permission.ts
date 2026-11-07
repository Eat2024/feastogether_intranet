import type { AuthorizationModule } from '@/api/types';

export type HasPermission = (moduleKey: string, ...permissions: string[]) => boolean;

/** 只在同一 module 內精確採 AND 比對；空需求與缺少 module 一律不授權。 */
export function hasPermission(
  modules: readonly AuthorizationModule[],
  moduleKey: string,
  ...permissions: string[]
): boolean {
  if (!moduleKey || permissions.length === 0) return false;
  const moduleEntry = modules.find((entry) => entry.moduleKey === moduleKey);
  if (!moduleEntry) return false;
  const granted = new Set(moduleEntry.permissions);
  return permissions.every((permission) => granted.has(permission));
}
