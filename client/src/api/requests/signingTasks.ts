import axios from 'axios';
import api from '@/api/config';
import { endpoints } from '@/api/endpoints';
import type { EsignSigningTask, GetSigningTasksParams, SubmitSigningTaskBody, SigningTaskSignatureResult, RejectSigningTaskBody, SigningTaskRejectionResult } from '@/api/types';

/**
 * @name 列出本人的簽署任務
 * @description 指派給目前員工、已發起的文件（含已停止、已到期）；不分頁。
 */
export const getSigningTasks = async (params: GetSigningTasksParams = {}): Promise<EsignSigningTask[]> => {
  const res = await api<EsignSigningTask[]>({ method: 'GET', url: endpoints.ESIGN_SIGNING_TASKS, params });
  return res.data;
};

/** 開啟本人任務並記錄一次開啟事件；不作輪詢。 */
export const openSigningTask = async (signerPublicId: string): Promise<EsignSigningTask> => {
  const res = await api<EsignSigningTask>({ method: 'POST', url: endpoints.ESIGN_SIGNING_TASK(signerPublicId) });
  return res.data;
};

export const submitSigningTaskSignatures = async (
  signerPublicId: string,
  body: SubmitSigningTaskBody,
): Promise<SigningTaskSignatureResult> => {
  const res = await api<SigningTaskSignatureResult>({ method: 'POST', url: endpoints.ESIGN_SIGNING_TASK_SIGNATURES(signerPublicId), data: body });
  return res.data;
};

export const signingTaskSourceFileUrl = (signerPublicId: string) =>
  `${api.defaults.baseURL}/${endpoints.ESIGN_SIGNING_TASK_SOURCE_FILE(signerPublicId)}`;

export const rejectSigningTask = async (signerPublicId: string, body: RejectSigningTaskBody): Promise<SigningTaskRejectionResult> => {
  const res = await api<SigningTaskRejectionResult>({ method: 'POST', url: endpoints.ESIGN_SIGNING_TASK_REJECTION(signerPublicId), data: body });
  return res.data;
};

/** 以 API 請求下載本人副本，讓登入過期與業務錯誤仍由全域 provider 處理。 */
export const downloadSigningTaskCompletedFile = async (signerPublicId: string): Promise<{ bytes: Blob; fileName: string }> => {
  try {
    const res = await api<Blob>({
      method: 'GET',
      url: endpoints.ESIGN_SIGNING_TASK_COMPLETED_FILE(signerPublicId),
      responseType: 'blob',
    });
    const disposition: unknown = res.headers['content-disposition'];
    const encoded = typeof disposition === 'string' ? /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] : undefined;
    if (!encoded) throw new Error('下載檔名格式不正確');
    return { bytes: res.data, fileName: decodeURIComponent(encoded) };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data instanceof Blob && error.response.data.type.includes('json')) {
      try {
        error.response.data = JSON.parse(await error.response.data.text());
      } catch {
        // 非 JSON 錯誤仍交由既有通用訊息處理。
      }
    }
    throw error;
  }
};
