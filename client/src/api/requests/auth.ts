import api from '@/api/config';
import { endpoints } from '@/api/endpoints';
import type { AuthSession } from '@/api/types';

/**
 * @name 取得目前身分
 * @description 員工或其他身分；未登入、過期或已撤銷回 401
 */
export const getSession = async (): Promise<AuthSession> => {
  const res = await api<AuthSession>({ method: 'GET', url: endpoints.AUTH_SESSION });
  return res.data;
};

/**
 * @name 登出
 * @description 撤銷目前會話並清除 cookie；沒有會話也視為完成
 */
export const deleteSession = async (): Promise<void> => {
  await api({ method: 'DELETE', url: endpoints.AUTH_SESSION });
};
