import api from '@/api/config';
import { endpoints } from '@/api/endpoints';
import type { AuthMe } from '@/api/types';
import { isAuthMeResponse } from '@/api/validators/authMe';

/**
 * @name 取得目前登入者與有效能力
 * @description 只接受 actor、user、expiresAt、modules；不解析角色資料
 */
export const getMe = async (signal?: AbortSignal): Promise<AuthMe> => {
  const res = await api<unknown>({ method: 'GET', url: endpoints.AUTH_ME, signal });
  if (!isAuthMeResponse(res.data)) throw new Error('AUTH_ME_INVALID_RESPONSE');
  return res.data;
};

/**
 * @name 登出
 * @description 撤銷目前會話並清除 cookie；沒有會話也視為完成
 */
export const deleteSession = async (): Promise<void> => {
  await api({ method: 'DELETE', url: endpoints.AUTH_SESSION });
};
