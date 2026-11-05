import api from '@/api/config';
import { endpoints } from '@/api/endpoints';
import type { AuthSession, SuperUserLoginBody, SuperUserSession } from '@/api/types';

/**
 * @name 取得目前身分
 * @description 員工或 Super user；未登入、過期或已撤銷回 401
 */
export const getSession = async (): Promise<AuthSession> => {
  const res = await api<AuthSession>({ method: 'GET', url: endpoints.AUTH_SESSION });
  return res.data;
};

/**
 * @name Super user 登入
 * @description 成功回 201 並以 HttpOnly cookie 替換目前會話；帳密錯誤 401、入口失效 404、
 * 同一舊會話已被其他登入取代 409、過於頻繁 429（Retry-After 秒數）
 */
export const createSuperUserSession = async ({
  entryKey,
  ...body
}: SuperUserLoginBody & { entryKey: string }): Promise<SuperUserSession> => {
  const res = await api<SuperUserSession>({
    method: 'POST',
    url: endpoints.SUPER_USER_ENTRY_SESSIONS(entryKey),
    data: body,
  });
  return res.data;
};

/**
 * @name 登出
 * @description 撤銷目前會話並清除 cookie；沒有會話也視為完成
 */
export const deleteSession = async (): Promise<void> => {
  await api({ method: 'DELETE', url: endpoints.AUTH_SESSION });
};
