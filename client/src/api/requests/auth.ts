import api from '@/api/config';
import { endpoints } from '@/api/endpoints';
import type { AuthMe } from '@/api/types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

/** 在瀏覽器邊界拒絕不完整或重複分組的能力快照，避免錯誤資料被當成授權依據。 */
const isAuthMe = (value: unknown): value is AuthMe => {
  if (
    !isRecord(value) || !isRecord(value.actor) || typeof value.expiresAt !== 'string' ||
    !value.expiresAt.trim() || Number.isNaN(Date.parse(value.expiresAt))
  ) return false;
  if ('roles' in value || !Array.isArray(value.modules)) return false;

  const moduleKeys = new Set<string>();
  const validModules = value.modules.every((entry) => {
    if (
      !isRecord(entry) || typeof entry.moduleKey !== 'string' ||
      !entry.moduleKey.trim() || entry.moduleKey !== entry.moduleKey.trim()
    ) return false;
    if (moduleKeys.has(entry.moduleKey) || !Array.isArray(entry.permissions)) return false;
    moduleKeys.add(entry.moduleKey);
    const permissions = new Set<string>();
    return entry.permissions.every((permission) => {
      if (
        typeof permission !== 'string' || !permission.trim() || permission !== permission.trim() ||
        permissions.has(permission)
      ) return false;
      permissions.add(permission);
      return true;
    });
  });
  if (!validModules || typeof value.actor.kind !== 'string' || !value.actor.kind) return false;

  if (value.actor.kind === 'employee') {
    const user = value.user;
    return (
      typeof value.actor.userId === 'number' &&
      Number.isSafeInteger(value.actor.userId) &&
      isRecord(user) &&
      typeof user.id === 'number' &&
      user.id === value.actor.userId &&
      typeof user.empId === 'string' &&
      typeof user.name === 'string' &&
      isNullableString(user.departmentName) &&
      isNullableString(user.titleName) &&
      isNullableString(user.lastLoginAt)
    );
  }

  return value.user === null && typeof value.actor.displayName === 'string' && !!value.actor.displayName.trim();
};

/**
 * @name 取得目前登入者與有效能力
 * @description 只接受 actor、user、expiresAt、modules；不解析角色資料
 */
export const getMe = async (signal?: AbortSignal): Promise<AuthMe> => {
  const res = await api<unknown>({ method: 'GET', url: endpoints.AUTH_ME, signal });
  if (!isAuthMe(res.data)) throw new Error('AUTH_ME_INVALID_RESPONSE');
  return res.data;
};

/**
 * @name 登出
 * @description 撤銷目前會話並清除 cookie；沒有會話也視為完成
 */
export const deleteSession = async (): Promise<void> => {
  await api({ method: 'DELETE', url: endpoints.AUTH_SESSION });
};
