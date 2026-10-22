import api from '@/api/config';
import { endpoints } from '@/api/endpoints';
import type { EsignSigningTask, GetSigningTasksParams } from '@/api/types';

/**
 * @name 列出本人的簽署任務
 * @description 指派給目前員工、已發起的文件（含已停止、已到期）；不分頁。
 * 簽署、拒簽與下載本人副本須從 Email 邀請並通過驗證碼（Spec 010），舊的個人操作 API 一律回 403
 */
export const getSigningTasks = async (params: GetSigningTasksParams = {}): Promise<EsignSigningTask[]> => {
  const res = await api<EsignSigningTask[]>({ method: 'GET', url: endpoints.ESIGN_SIGNING_TASKS, params });
  return res.data;
};
