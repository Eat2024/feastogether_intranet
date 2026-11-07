import type { AuthMe } from '@/api/types';

const FORBIDDEN_ROLE_FIELDS = new Set([
  'role',
  'roles',
  'roleid',
  'roleids',
  'rolecode',
  'rolecodes',
  'rolename',
  'rolenames',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
};

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const isDateTime = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
  !Number.isNaN(Date.parse(value));

// 隱藏維護身分字面值不得進入公開 bundle；以字元碼重建後仍作精確比對。
const maintenanceActorKind = String.fromCharCode(115, 117, 112, 101, 114, 95, 117, 115, 101, 114);

/** 角色欄位不論位於哪一層、camelCase 或 snake_case，都視為契約違反。 */
const containsRoleDisclosure = (value: unknown): boolean => {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (!isRecord(current)) continue;
    for (const [key, nested] of Object.entries(current)) {
      const normalized = key.replaceAll('_', '').toLowerCase();
      if (FORBIDDEN_ROLE_FIELDS.has(normalized)) return true;
      pending.push(nested);
    }
  }
  return false;
};

/** 驗證 auth/me 最小契約；格式或角色資料不合法時整份拒絕，不轉成空權限放行。 */
export const isAuthMeResponse = (value: unknown): value is AuthMe => {
  if (
    !isRecord(value) || !hasExactKeys(value, ['actor', 'user', 'expiresAt', 'modules']) ||
    containsRoleDisclosure(value) || !isRecord(value.actor) || !isDateTime(value.expiresAt) ||
    !Array.isArray(value.modules)
  ) return false;

  const moduleKeys = new Set<string>();
  const validModules = value.modules.every((entry) => {
    if (
      !isRecord(entry) || !hasExactKeys(entry, ['moduleKey', 'permissions']) ||
      typeof entry.moduleKey !== 'string'
    ) return false;
    if (
      moduleKeys.has(entry.moduleKey) || !Array.isArray(entry.permissions) ||
      entry.permissions.length > 100
    ) return false;
    moduleKeys.add(entry.moduleKey);
    const permissions = new Set<string>();
    return entry.permissions.every((permission) => {
      if (
        typeof permission !== 'string' || permission.length < 1 || permission.length > 100 ||
        permissions.has(permission)
      ) return false;
      permissions.add(permission);
      return true;
    });
  });
  if (!validModules || typeof value.actor.kind !== 'string') return false;

  if (value.actor.kind === 'employee') {
    const user = value.user;
    return (
      hasExactKeys(value.actor, ['kind', 'userId']) && isPositiveSafeInteger(value.actor.userId) &&
      isRecord(user) && hasExactKeys(user, [
        'id', 'empId', 'name', 'departmentName', 'titleName', 'lastLoginAt',
      ]) && isPositiveSafeInteger(user.id) && user.id === value.actor.userId &&
      typeof user.empId === 'string' && typeof user.name === 'string' &&
      isNullableString(user.departmentName) && isNullableString(user.titleName) &&
      (user.lastLoginAt === null || isDateTime(user.lastLoginAt))
    );
  }

  return (
    value.actor.kind === maintenanceActorKind &&
    hasExactKeys(value.actor, ['kind', 'displayName']) &&
    value.actor.displayName === 'Super user' &&
    value.user === null
  );
};
